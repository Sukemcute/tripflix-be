import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import type { InboxRow } from '../inbox/inbox.repository.js';
import { canCreatePostInteraction, lockPostNotifications } from '../inbox/post-notification.repository.js';
import { DB } from '../tokens.js';

const WINDOW_MS = 120_000;

export interface ReactionChange {
  postId: string;
  commentId?: string;
  ownerId?: string;
  actorId: string;
  isActive: boolean;
  eventId: string;
  occurredAt: string;
}

interface ActorState {
  inbox_id: string | null;
  is_active: boolean;
}

@Injectable()
export class ReactionNotificationRepository {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async apply(change: ReactionChange): Promise<{ row: InboxRow; isNew: boolean } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.applyInTransaction(client, change);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async applyInTransaction(client: pg.PoolClient, change: ReactionChange) {
    const { postId, commentId, actorId, isActive, occurredAt, eventId } = change;
    const targetId = commentId ?? postId;
    const type = commentId ? 'reaction.comment' : 'reaction.post';
    // Cùng khóa với luồng xóa bình luận để lượt thích đến muộn không làm hiện lại thông báo.
    await lockPostNotifications(client, postId);
    if (!(await canCreatePostInteraction(client, postId, occurredAt))) return null;
    if (commentId) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('notification.comment'), hashtext($1))", [commentId]);
      const deleted = await client.query('SELECT 1 FROM deleted_notification_comments WHERE comment_id = $1', [commentId]);
      if (deleted.rowCount) return null;
    }
    const post = (await client.query<{ author_id: string; deleted_at: Date | null }>(
      'SELECT author_id, deleted_at FROM post_directory WHERE post_id = $1', [postId],
    )).rows[0];
    const ownerId = change.ownerId ?? (commentId ? undefined : post?.author_id);
    if (!ownerId || ownerId === actorId || post?.deleted_at) return null;

    const stateKey = [ownerId, type, targetId, actorId];
    const previous = (await client.query<ActorState>(
      `SELECT inbox_id, is_active FROM reaction_notification_actors
       WHERE user_id = $1 AND type = $2 AND target_id = $3 AND actor_id = $4`,
      stateKey,
    )).rows[0];
    const accepted = await client.query(
      `INSERT INTO reaction_notification_actors
         (user_id, type, target_id, actor_id, is_active, occurred_at, event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, type, target_id, actor_id) DO UPDATE
       SET is_active = EXCLUDED.is_active, occurred_at = EXCLUDED.occurred_at, event_id = EXCLUDED.event_id
       WHERE reaction_notification_actors.occurred_at <= EXCLUDED.occurred_at
         AND reaction_notification_actors.event_id <> EXCLUDED.event_id`,
      [...stateKey, isActive, occurredAt, eventId],
    );
    if (!accepted.rowCount || (previous?.is_active ?? false) === isActive) return null;

    let inboxId = previous?.inbox_id;
    let isNew = false;
    if (!inboxId) {
      const window = Math.floor(Date.parse(occurredAt) / WINDOW_MS);
      const key = `${ownerId}:${type}:${targetId}:${window}:`;
      inboxId = (await client.query<{ id: string }>(
        `SELECT id FROM inbox WHERE group_key COLLATE "C" >= $1 AND group_key COLLATE "C" < $2
           AND read_at IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [key, key + '~'],
      )).rows[0]?.id;
      if (!inboxId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id, comment_id, group_key, interaction_occurred_at)
           VALUES ($1, $2, $3, '', $4, $5::jsonb, $6, $7, $8, $9)
           ON CONFLICT (group_key) WHERE group_key IS NOT NULL DO NOTHING RETURNING id`,
          [ownerId, type, commentId ? 'Có lượt thích bình luận' : 'Có cảm xúc mới',
            `/trips/${postId}`, JSON.stringify({ postId, ...(commentId ? { commentId } : {}), actorCount: 0 }),
            eventId, commentId ?? null, key + eventId, occurredAt],
        );
        inboxId = inserted.rows[0]?.id;
        if (!inboxId) return null;
        isNew = true;
      }
      await client.query(
        `UPDATE reaction_notification_actors SET inbox_id = $5
         WHERE user_id = $1 AND type = $2 AND target_id = $3 AND actor_id = $4`,
        [...stateKey, inboxId],
      );
    }
    const { rows } = await client.query<InboxRow>(
      `WITH totals AS (
         SELECT COALESCE((data->>'actorCount')::integer, 0) + $2::integer AS actor_count
         FROM inbox WHERE id = $1
       )
       UPDATE inbox SET
         data = jsonb_set(data, '{actorCount}', to_jsonb(totals.actor_count)),
         body = totals.actor_count || $3::text,
         deleted_at = CASE WHEN totals.actor_count = 0 THEN now() ELSE NULL END,
         read_at = CASE WHEN totals.actor_count = 0 THEN COALESCE(read_at, now()) ELSE read_at END
       FROM totals WHERE id = $1 AND NOT is_post_interaction_suppressed RETURNING inbox.*`,
      [inboxId, isActive ? 1 : -1, commentId ? ' người đã thích bình luận của bạn.' : ' người đã thả cảm xúc vào bài của bạn.'],
    );
    return rows[0] ? { row: rows[0], isNew } : null;
  }
}
