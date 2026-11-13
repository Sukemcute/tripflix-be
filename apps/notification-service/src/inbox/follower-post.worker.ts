import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../env.js';
import { DB, ENV } from '../tokens.js';

const PAGE_SIZE = 200;
const ServiceToken = z.object({ accessToken: z.string().min(1), expiresIn: z.number().positive() });
const RecipientPage = z.object({
  sharedPublishedAt: z.iso.datetime().optional(),
  isEligible: z.boolean(), recipients: z.array(z.uuid()).max(PAGE_SIZE), nextCursor: z.uuid().nullable(),
});

interface Job {
  post_id: string;
  author_id: string;
  cursor: string | null;
  attempts: number;
}

@Injectable()
export class FollowerPostWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FollowerPostWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private token?: { value: string; expiresAt: number };

  constructor(@Inject(DB) private readonly pool: pg.Pool, @Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_CONSUMER_ENABLED || !this.env.FOLLOWER_NOTIFICATION_SECRET) return;
    this.timer = setInterval(() => {
      if (!this.pending) {
        this.pending = this.runOne()
          .catch(() => { this.logger.error('Lỗi worker thông báo bài mới'); })
          .finally(() => { this.pending = undefined; });
      }
    }, 500);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
  }

  async applyFollow(input: { followerId: string; authorId: string; followedAt: string | null; changedAt: string }) {
    await this.pool.query(
      `INSERT INTO notification_follows (follower_id, author_id, followed_at, changed_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (follower_id, author_id) DO UPDATE SET followed_at = EXCLUDED.followed_at, changed_at = EXCLUDED.changed_at
       WHERE notification_follows.changed_at < EXCLUDED.changed_at
          OR (notification_follows.changed_at = EXCLUDED.changed_at AND EXCLUDED.followed_at IS NULL)`,
      [input.followerId, input.authorId, input.followedAt, input.changedAt],
    );
  }

  async enqueue(postId: string, authorId: string): Promise<void> {
    if (!this.env.FOLLOWER_NOTIFICATION_SECRET) return;
    await this.pool.query(
      'INSERT INTO follower_post_jobs (post_id, author_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [postId, authorId],
    );
  }

  async cancel(postId: string, authorId: string): Promise<void> {
    if (!this.env.FOLLOWER_NOTIFICATION_SECRET) {
      await this.pool.query("UPDATE follower_post_jobs SET state = 'cancelled' WHERE post_id = $1", [postId]);
      return;
    }
    await this.pool.query(
      `INSERT INTO follower_post_jobs (post_id, author_id, state) VALUES ($1, $2, 'cancelled')
       ON CONFLICT (post_id) DO UPDATE SET state = 'cancelled'`,
      [postId, authorId],
    );
  }

  private async runOne(): Promise<void> {
    const client = await this.pool.connect();
    let locked = false;
    let unlockError: Error | undefined;
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('notification.follower-worker')) AS acquired",
      );
      locked = lock.rows[0]?.acquired === true;
      if (!locked) return;

      const { rows: [job] } = await client.query<Job>(
        `SELECT post_id, author_id, cursor, attempts FROM follower_post_jobs
         WHERE state = 'pending' AND available_at <= now()
         ORDER BY available_at, post_id LIMIT 1`,
      );
      if (!job) return;

      try {
        const page = await this.getRecipients(job);
        if (!page.isEligible) {
          await client.query("UPDATE follower_post_jobs SET state = 'cancelled' WHERE post_id = $1", [job.post_id]);
          return;
        }
        if (page.nextCursor && (page.nextCursor === job.cursor || page.nextCursor !== page.recipients.at(-1))) {
          throw new Error('Cursor follower không tiến');
        }
        if (!job.cursor && page.sharedPublishedAt) {
          await client.query(`UPDATE follower_post_jobs SET state = 'done', shared_published_at = $2, shared_created_at = now()
            WHERE post_id = $1 AND state = 'pending'`, [job.post_id, page.sharedPublishedAt]);
        } else {
          await this.savePage(client, job, page);
        }
      } catch {
        await client.query(
          `UPDATE follower_post_jobs SET attempts = attempts + 1,
             state = CASE WHEN attempts >= 7 THEN 'failed' ELSE state END,
             available_at = now() + make_interval(secs => $2)
           WHERE post_id = $1 AND state = 'pending'`,
          [job.post_id, Math.min(300, 2 ** (job.attempts + 1))],
        );
        this.logger.warn({ postId: job.post_id, attempt: job.attempts + 1 }, 'Không ghi được lô thông báo bài mới');
      }
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('notification.follower-worker'))");
        } catch {
          unlockError = new Error('Không nhả được khóa worker');
        }
      }
      client.release(unlockError);
    }
  }

  private async savePage(client: pg.PoolClient, job: Job, page: z.infer<typeof RecipientPage>): Promise<void> {
    await client.query('BEGIN');
    try {
      // Khóa hàng job để sự kiện hủy và transaction ghi inbox có cùng thứ tự.
      const active = await client.query(
        "SELECT 1 FROM follower_post_jobs WHERE post_id = $1 AND state = 'pending' FOR UPDATE", [job.post_id],
      );
      if (active.rowCount) {
        await client.query(
          `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id)
           SELECT recipient, 'follow.post.published', 'Có bài viết mới',
             COALESCE(NULLIF(btrim(actor.display_name), ''), 'Người bạn theo dõi') || ' vừa đăng bài mới.',
             $3, jsonb_build_object('postId', $1::uuid), 'follower-post:' || $1::text
           FROM unnest($2::uuid[]) AS recipients(recipient)
           LEFT JOIN user_directory AS actor ON actor.user_id = $4
           WHERE recipient <> $4
           ON CONFLICT DO NOTHING`,
          [job.post_id, page.recipients, `/trips/${job.post_id}`, job.author_id],
        );
        await client.query(
          `UPDATE follower_post_jobs SET cursor = $2, attempts = 0, available_at = now(),
             state = CASE WHEN $2::uuid IS NULL THEN 'done' ELSE 'pending' END WHERE post_id = $1`,
          [job.post_id, page.nextCursor],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  private async getRecipients(job: Job): Promise<z.infer<typeof RecipientPage>> {
    const baseUrl = this.env.FOLLOWER_CORE_URL;
    if (!baseUrl) throw new Error('Thiếu URL Core API');
    if (!this.token || this.token.expiresAt <= Date.now()) {
      const response = await fetch(new URL('/api/auth/service-token', baseUrl), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: 'notification-service', clientSecret: this.env.FOLLOWER_NOTIFICATION_SECRET, audience: 'core-api',
        }),
        redirect: 'error', signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('Core từ chối token dịch vụ');
      const token = ServiceToken.parse(await response.json());
      this.token = { value: token.accessToken, expiresAt: Date.now() + Math.max(0, token.expiresIn - 30) * 1000 };
    }
    const url = new URL(`/api/v1/internal/posts/${job.post_id}/follower-recipients`, baseUrl);
    if (job.cursor) url.searchParams.set('cursor', job.cursor);
    else if (this.env.FOLLOWER_SHARED_THRESHOLD) url.searchParams.set('sharedThreshold', String(this.env.FOLLOWER_SHARED_THRESHOLD));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.token.value}` }, redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401) this.token = undefined;
    if (!response.ok) throw new Error('Core không trả được danh sách follower');
    return RecipientPage.parse(await response.json());
  }
}
