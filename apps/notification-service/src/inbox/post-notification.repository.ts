import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DB } from '../tokens.js';
import type { InboxInsert, InboxRow } from './inbox.repository.js';

export async function lockPostNotifications(client: pg.PoolClient, postId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('notification.post-reaction'), hashtext($1))", [postId]);
}

export async function canCreatePostInteraction(
  client: pg.PoolClient, postId: string, occurredAt: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM post_notification_moderation
     WHERE post_id = $1 AND (is_hidden OR changed_at >= $2)`,
    [postId, occurredAt],
  );
  return !result.rowCount;
}

@Injectable()
export class PostNotificationRepository {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async moderate(input: {
    postId: string;
    occurredAt: string;
    isHidden: boolean;
    item: InboxInsert;
  }): Promise<{ row: InboxRow | null; invalidatedUsers: string[] }> {
    const { postId, occurredAt, isHidden, item } = input;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockPostNotifications(client, postId);
      const { rows: [state] } = await client.query<{ is_current: boolean; changed_at: string }>(
        `INSERT INTO post_notification_moderation (post_id, changed_at, is_hidden)
         VALUES ($1, $2, $3)
         ON CONFLICT (post_id) DO UPDATE SET
           changed_at = GREATEST(post_notification_moderation.changed_at, EXCLUDED.changed_at),
           is_hidden = CASE WHEN EXCLUDED.changed_at > post_notification_moderation.changed_at
                            THEN EXCLUDED.is_hidden ELSE post_notification_moderation.is_hidden END
         RETURNING changed_at = $2 AND is_hidden = $3 AS is_current, changed_at::text AS changed_at`,
        [postId, occurredAt, isHidden],
      );

      const invalidated = isHidden
        ? await client.query<{ user_id: string }>(
          `UPDATE inbox SET deleted_at = $2
           WHERE deleted_at IS NULL AND data->>'postId' = $1
             AND (type LIKE 'comment.%' OR type LIKE 'reaction.%')
             AND ($3 OR COALESCE(interaction_occurred_at, created_at) <= $4)
           RETURNING user_id`,
          [postId, occurredAt, state!.is_current, state!.changed_at],
        )
        : null;
      const notice = state!.is_current
        ? await client.query<InboxRow>(
          `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT DO NOTHING RETURNING *`,
          [item.userId, item.type, item.title, item.body, item.link, item.data, item.sourceEventId],
        )
        : null;
      await client.query('COMMIT');
      return {
        row: notice?.rows[0] ?? null,
        invalidatedUsers: [...new Set(invalidated?.rows.map((row) => row.user_id))],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
