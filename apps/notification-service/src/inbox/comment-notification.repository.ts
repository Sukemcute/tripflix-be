import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import type { InboxRow } from '../inbox/inbox.repository.js';
import { DB } from '../tokens.js';
import { canCreatePostInteraction, lockPostNotifications } from './post-notification.repository.js';

interface CommentRecipient {
  userId: string;
  isReplyRecipient: boolean;
}

@Injectable()
export class CommentNotificationRepository {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async create(input: {
    commentId: string;
    postId: string;
    authorId: string;
    authorDisplayName?: string;
    parentCommentId: string | null;
    eventId: string;
    occurredAt: string;
    recipients: CommentRecipient[];
  }): Promise<InboxRow[]> {
    return this.withCommentLock(input.commentId, async (client) => {
      if (!(await canCreatePostInteraction(client, input.postId, input.occurredAt))) return [];
      const { rows } = await client.query<InboxRow>(
        `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id, comment_id, interaction_occurred_at)
         SELECT recipient.user_id,
           CASE WHEN recipient.is_reply THEN 'comment.replied' ELSE 'comment.created' END,
           CASE WHEN recipient.is_reply THEN COALESCE($9::text, NULLIF(btrim(actor.display_name), ''), 'Một người dùng') || ' đã trả lời bình luận' ELSE 'Có bình luận mới' END,
           COALESCE($9::text, NULLIF(btrim(actor.display_name), ''), 'Một người dùng') ||
             CASE WHEN recipient.is_reply THEN ' đã trả lời bình luận của bạn.' ELSE ' đã bình luận bài của bạn.' END,
           $4, $5::jsonb, $6, $7::uuid, $8
         FROM unnest($1::uuid[], $2::boolean[]) AS recipient(user_id, is_reply)
         LEFT JOIN user_directory AS actor ON actor.user_id = $3
         WHERE NOT EXISTS (SELECT 1 FROM deleted_notification_comments WHERE comment_id = $7)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          input.recipients.map((recipient) => recipient.userId),
          input.recipients.map((recipient) => recipient.isReplyRecipient),
          input.authorId,
          `/trips/${input.postId}?comment=${input.commentId}`,
          JSON.stringify({ postId: input.postId, commentId: input.commentId, parentCommentId: input.parentCommentId }),
          input.eventId,
          input.commentId,
          input.occurredAt,
          input.authorDisplayName ?? null,
        ],
      );
      return rows;
    }, input.postId);
  }

  async hide(commentId: string, deletedAt: string): Promise<string[]> {
    return this.withCommentLock(commentId, async (client) => {
      await client.query(
        'INSERT INTO deleted_notification_comments (comment_id, deleted_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [commentId, deletedAt],
      );
      const { rows } = await client.query<{ user_id: string }>(
        'UPDATE inbox SET deleted_at = $2 WHERE comment_id = $1 AND deleted_at IS NULL RETURNING user_id',
        [commentId, deletedAt],
      );
      return [...new Set(rows.map((row) => row.user_id))];
    });
  }

  private async withCommentLock<T>(commentId: string, work: (client: pg.PoolClient) => Promise<T>, postId?: string): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (postId) await lockPostNotifications(client, postId);
      // Hai worker có thể xử lý sự kiện tạo và xóa của cùng bình luận đồng thời.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('notification.comment'), hashtext($1))", [commentId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
