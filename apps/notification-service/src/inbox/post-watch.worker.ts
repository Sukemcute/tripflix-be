import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type pg from 'pg';
import type { Env } from '../env.js';
import { DB, ENV } from '../tokens.js';
import { canCreatePostInteraction, lockPostNotifications } from './post-notification.repository.js';

export const POST_WATCH_TYPE = 'comment.watched_post';
export const POST_WATCH_PAGE_SIZE = 200;
// Một lượt giữ khoá tối đa ~400 ms rồi nhả, nhịp 500 ms vẫn chạy lượt kế tiếp.
export const POST_WATCH_ROUND_BUDGET_MS = 400;

interface PostWatchJob {
  comment_id: string;
  post_id: string;
  post_author_id: string;
  author_id: string;
  author_display_name: string | null;
  event_id: string;
  occurred_at: Date;
  cursor: string | null;
  attempts: number;
}

/** Người bình luận theo dõi bài. Đã tắt thì giữ nguyên, bình luận lại không bật lại. */
export async function recordPostWatcher(client: pg.PoolClient, postId: string, userId: string, occurredAt: string) {
  await client.query(
    'INSERT INTO post_watchers (post_id, user_id, changed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [postId, userId, occurredAt],
  );
}

export async function enqueuePostWatchJob(
  client: pg.PoolClient,
  input: {
    commentId: string; postId: string; postAuthorId: string; authorId: string;
    authorDisplayName?: string; eventId: string; occurredAt: string;
  },
) {
  await client.query(
    `INSERT INTO post_watch_jobs (comment_id, post_id, post_author_id, author_id, author_display_name, event_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [input.commentId, input.postId, input.postAuthorId, input.authorId, input.authorDisplayName ?? null,
      input.eventId, input.occurredAt],
  );
}

/**
 * N1: báo bình luận gốc mới cho người theo dõi bài, theo lô user_id.
 * Mỗi người một dòng gom theo bài khi chưa đọc. Không phát realtime, giống thông báo bài mới của follower.
 */
@Injectable()
export class PostWatchWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PostWatchWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<unknown>;

  constructor(@Inject(DB) private readonly pool: pg.Pool, @Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_CONSUMER_ENABLED) return;
    this.timer = setInterval(() => {
      this.pending ??= this.runOnce()
        .catch(() => { this.logger.error('Lỗi worker thông báo bài đang theo dõi'); })
        .finally(() => { this.pending = undefined; });
    }, 500);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
  }

  /** Trả null khi người dùng chưa từng bình luận bài: chỉ người đã bình luận mới bật/tắt được. */
  async getWatching(userId: string, postId: string): Promise<boolean | null> {
    const { rows } = await this.pool.query<{ is_muted: boolean }>(
      'SELECT is_muted FROM post_watchers WHERE post_id = $1 AND user_id = $2', [postId, userId],
    );
    return rows[0] ? !rows[0].is_muted : null;
  }

  async setWatching(userId: string, postId: string, isWatching: boolean): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE post_watchers SET is_muted = $3, changed_at = now() WHERE post_id = $1 AND user_id = $2',
      [postId, userId, !isWatching],
    );
    return Boolean(result.rowCount);
  }

  /**
   * Chạy liên tục các lô đang chờ tới khi hết job hoặc hết thời gian của lượt, để bài nóng không dồn hàng đợi.
   * Trả số lô đã xử lý (0 khi không có việc hoặc replica khác đang giữ khoá).
   */
  async runOnce(budgetMs = POST_WATCH_ROUND_BUDGET_MS): Promise<number> {
    const deadline = Date.now() + budgetMs;
    const client = await this.pool.connect();
    let locked = false;
    let unlockError: Error | undefined;
    let pages = 0;
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('notification.post-watch-worker')) AS acquired",
      );
      locked = lock.rows[0]?.acquired === true;
      if (!locked) return 0;
      while (pages === 0 || Date.now() < deadline) {
        const { rows: [job] } = await client.query<PostWatchJob>(
          `SELECT * FROM post_watch_jobs WHERE state = 'pending' AND available_at <= now()
           ORDER BY available_at, comment_id LIMIT 1`,
        );
        if (!job) break;
        try {
          await this.processPage(client, job);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          // Lùi available_at nên vòng lặp sang job khác, không kẹt ở job lỗi.
          await client.query(
            `UPDATE post_watch_jobs SET attempts = attempts + 1,
               state = CASE WHEN attempts >= 7 THEN 'failed' ELSE state END,
               available_at = now() + make_interval(secs => $2)
             WHERE comment_id = $1 AND state = 'pending'`,
            [job.comment_id, Math.min(300, 2 ** (job.attempts + 1))],
          );
          this.logger.warn({ err: error, commentId: job.comment_id, attempt: job.attempts + 1 }, 'Không ghi được lô thông báo bài đang theo dõi');
        }
        pages += 1;
      }
      return pages;
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('notification.post-watch-worker'))");
        } catch {
          unlockError = new Error('Không nhả được khóa worker');
        }
      }
      client.release(unlockError);
    }
  }

  private async processPage(client: pg.PoolClient, job: PostWatchJob): Promise<void> {
    await client.query('BEGIN');
    // Cùng khóa với luồng xóa/ẩn bình luận và kiểm duyệt bài để không làm hiện lại thông báo đã thu hồi.
    await lockPostNotifications(client, job.post_id);
    await client.query("SELECT pg_advisory_xact_lock(hashtext('notification.comment'), hashtext($1))", [job.comment_id]);
    const deleted = await client.query('SELECT 1 FROM deleted_notification_comments WHERE comment_id = $1', [job.comment_id]);
    if (deleted.rowCount || !(await canCreatePostInteraction(client, job.post_id, job.occurred_at.toISOString()))) {
      await client.query("UPDATE post_watch_jobs SET state = 'cancelled' WHERE comment_id = $1", [job.comment_id]);
      await client.query('COMMIT');
      return;
    }
    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM post_watchers
       WHERE post_id = $1 AND NOT is_muted AND user_id <> ALL($2::uuid[]) AND ($3::uuid IS NULL OR user_id > $3)
       ORDER BY user_id LIMIT $4`,
      [job.post_id, [job.post_author_id, job.author_id], job.cursor, POST_WATCH_PAGE_SIZE],
    );
    const recipients = rows.map((row) => row.user_id);
    if (recipients.length) await this.writeRows(client, job, recipients);
    const nextCursor = recipients.length === POST_WATCH_PAGE_SIZE ? recipients.at(-1) : null;
    await client.query(
      `UPDATE post_watch_jobs SET cursor = $2, attempts = 0, available_at = now(),
         state = CASE WHEN $2::uuid IS NULL THEN 'done' ELSE 'pending' END WHERE comment_id = $1`,
      [job.comment_id, nextCursor],
    );
    await client.query('COMMIT');
  }

  /** Cập nhật dòng chưa đọc đã có của từng người, ai chưa có thì tạo dòng mới. */
  private async writeRows(client: pg.PoolClient, job: PostWatchJob, recipients: string[]): Promise<void> {
    const actorName = job.author_display_name ?? (await client.query<{ name: string }>(
      `SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Một người dùng') AS name FROM user_directory WHERE user_id = $1`,
      [job.author_id],
    )).rows[0]?.name ?? 'Một người dùng';
    const keySuffix = `:${POST_WATCH_TYPE}:${job.post_id}:`;
    const link = `/trips/${job.post_id}?comment=${job.comment_id}`;
    const unreadRow = `i.user_id = r.user_id
      AND i.group_key COLLATE "C" >= r.user_id::text || $2 AND i.group_key COLLATE "C" < r.user_id::text || $2 || '~'
      AND i.read_at IS NULL AND i.deleted_at IS NULL AND NOT i.is_post_interaction_suppressed`;
    await client.query(
      `WITH targets AS (
         SELECT DISTINCT ON (i.user_id) i.id,
           CASE WHEN i.data->'actorIds' ? $3::text THEN i.data->'actorIds'
             ELSE COALESCE(i.data->'actorIds', '[]'::jsonb) || to_jsonb($3::text) END AS actor_ids
         FROM unnest($1::uuid[]) AS r(user_id) JOIN inbox AS i ON ${unreadRow}
         ORDER BY i.user_id, i.created_at DESC, i.id DESC
       )
       UPDATE inbox SET comment_id = $4::uuid, link = $5, interaction_occurred_at = $6,
         data = inbox.data || jsonb_build_object('commentId', $4::text, 'actorIds', targets.actor_ids),
         body = $7::text || CASE WHEN jsonb_array_length(targets.actor_ids) > 1
           THEN ' và ' || (jsonb_array_length(targets.actor_ids) - 1) || ' người khác' ELSE '' END
           || ' đã bình luận bài bạn theo dõi.'
       FROM targets WHERE inbox.id = targets.id`,
      [recipients, keySuffix, job.author_id, job.comment_id, link, job.occurred_at, actorName],
    );
    await client.query(
      `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id, comment_id, group_key, interaction_occurred_at)
       SELECT r.user_id, $3, 'Có bình luận mới ở bài bạn theo dõi', $8::text || ' đã bình luận bài bạn theo dõi.', $5,
         jsonb_build_object('postId', $9::text, 'commentId', $4::text, 'actorIds', jsonb_build_array($10::text)),
         $7, $4::uuid, r.user_id::text || $2 || $7, $6
       FROM unnest($1::uuid[]) AS r(user_id)
       WHERE NOT EXISTS (SELECT 1 FROM inbox AS i WHERE ${unreadRow})
       ON CONFLICT DO NOTHING`,
      [recipients, keySuffix, POST_WATCH_TYPE, job.comment_id, link, job.occurred_at, job.event_id, actorName,
        job.post_id, job.author_id],
    );
  }
}
