import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import type { InboxRow } from '../inbox/inbox.repository.js';
import { DB } from '../tokens.js';
import { canCreatePostInteraction, lockPostNotifications } from './post-notification.repository.js';
import { enqueuePostWatchJob, recordPostWatcher } from './post-watch.worker.js';

export type CommentNotificationType = 'comment.created' | 'comment.replied' | 'comment.mentioned';

interface CommentRecipient {
  userId: string;
  type: CommentNotificationType;
}

export const THREAD_REPLY_TYPE = 'comment.thread_replied';

export interface ThreadNotification {
  row: InboxRow;
  isNew: boolean;
}

export function threadReplyBody(actorName: string, actorCount: number): string {
  const others = actorCount > 1 ? ` và ${actorCount - 1} người khác` : '';
  return `${actorName}${others} đã trả lời trong luồng bạn tham gia.`;
}

const EXCERPT_LENGTH = 100;

/** Đoạn trích ngắn để banner trên app hiện nội dung bình luận mà không phải tải bài. */
export function toCommentExcerpt(body: string | undefined): string | undefined {
  const text = body?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length > EXCERPT_LENGTH ? `${chars.slice(0, EXCERPT_LENGTH - 1).join('')}…` : text;
}

@Injectable()
export class CommentNotificationRepository {
  constructor(@Inject(DB) private readonly pool: pg.Pool) {}

  async create(input: {
    commentId: string;
    postId: string;
    authorId: string;
    authorDisplayName?: string;
    commentBody?: string;
    parentCommentId: string | null;
    eventId: string;
    occurredAt: string;
    recipients: CommentRecipient[];
  }): Promise<InboxRow[]> {
    return this.withCommentLock(input.commentId, async (client) => {
      if (!(await canCreatePostInteraction(client, input.postId, input.occurredAt))) return [];
      const { rows } = await client.query<InboxRow>(
        `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id, comment_id, interaction_occurred_at)
         SELECT recipient.user_id, recipient.type,
           CASE recipient.type
             WHEN 'comment.replied' THEN COALESCE($9::text, NULLIF(btrim(actor.display_name), ''), 'Một người dùng') || ' đã trả lời bình luận'
             WHEN 'comment.mentioned' THEN COALESCE($9::text, NULLIF(btrim(actor.display_name), ''), 'Một người dùng') || ' đã nhắc đến bạn'
             ELSE 'Có bình luận mới' END,
           COALESCE($9::text, NULLIF(btrim(actor.display_name), ''), 'Một người dùng') || CASE recipient.type
             WHEN 'comment.replied' THEN ' đã trả lời bình luận của bạn.'
             WHEN 'comment.mentioned' THEN ' đã nhắc đến bạn trong một bình luận.'
             ELSE ' đã bình luận bài của bạn.' END,
           $4, $5::jsonb, $6, $7::uuid, $8
         FROM unnest($1::uuid[], $2::text[]) AS recipient(user_id, type)
         LEFT JOIN user_directory AS actor ON actor.user_id = $3
         WHERE NOT EXISTS (SELECT 1 FROM deleted_notification_comments WHERE comment_id = $7)
           -- TF25: mỗi (bình luận, người nhận) tối đa một thông báo; sự kiện phát lại với eventId khác cũng không tạo tag trùng.
           AND (recipient.type <> 'comment.mentioned' OR NOT EXISTS (
             SELECT 1 FROM inbox AS existing
             WHERE existing.comment_id = $7 AND existing.user_id = recipient.user_id
               AND existing.type IN ('comment.created', 'comment.replied', 'comment.mentioned')))
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          input.recipients.map((recipient) => recipient.userId),
          input.recipients.map((recipient) => recipient.type),
          input.authorId,
          `/trips/${input.postId}?comment=${input.commentId}`,
          JSON.stringify({
            postId: input.postId,
            commentId: input.commentId,
            parentCommentId: input.parentCommentId,
            excerpt: toCommentExcerpt(input.commentBody),
          }),
          input.eventId,
          input.commentId,
          input.occurredAt,
          input.authorDisplayName ?? null,
        ],
      );
      return rows;
    }, input.postId);
  }

  /**
   * N2: ghi người tham gia luồng rồi báo cho những người còn lại trong luồng. N1: ghi người theo dõi bài, xếp job cho bình luận gốc.
   * Người trong `excludedUserIds` (người viết, chủ bài, người được trả lời trực tiếp) đã có dòng riêng từ `create`.
   * Mỗi người một dòng gom theo luồng khi chưa đọc; dòng gom giữ id bình luận mới nhất nên xoá bình luận đó thì ẩn cả dòng.
   */
  async notifyThread(input: {
    commentId: string;
    postId: string;
    authorId: string;
    authorDisplayName?: string;
    commentBody?: string;
    parentCommentId: string | null;
    parentCommentAuthorId?: string | null;
    postAuthorId?: string;
    excludedUserIds: string[];
    eventId: string;
    occurredAt: string;
  }): Promise<ThreadNotification[]> {
    return this.withCommentLock(input.commentId, async (client) => {
      if (!(await canCreatePostInteraction(client, input.postId, input.occurredAt))) return [];
      const deleted = await client.query('SELECT 1 FROM deleted_notification_comments WHERE comment_id = $1', [input.commentId]);
      if (deleted.rowCount) return [];
      const rootId = input.parentCommentId ?? input.commentId;
      const joiners = input.parentCommentId
        ? [input.parentCommentAuthorId, input.authorId].filter((id): id is string => Boolean(id))
        : [input.authorId];
      await client.query(
        `INSERT INTO thread_participants (parent_comment_id, user_id, joined_at)
         SELECT $1, user_id, $3 FROM unnest($2::uuid[]) AS user_id ON CONFLICT DO NOTHING`,
        [rootId, joiners, input.occurredAt],
      );
      // N1: người bình luận theo dõi bài (giữ trạng thái đã tắt); bình luận gốc thì xếp job báo người theo dõi.
      await recordPostWatcher(client, input.postId, input.authorId, input.occurredAt);
      if (!input.parentCommentId) {
        if (input.postAuthorId) {
          await enqueuePostWatchJob(client, { ...input, postAuthorId: input.postAuthorId });
        }
        return [];
      }

      const recipients = await client.query<{ user_id: string }>(
        'SELECT user_id FROM thread_participants WHERE parent_comment_id = $1 AND NOT (user_id = ANY($2::uuid[]))',
        [rootId, [...input.excludedUserIds, input.authorId]],
      );
      if (!recipients.rowCount) return [];
      const actorName = input.authorDisplayName ?? (await client.query<{ name: string }>(
        `SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Một người dùng') AS name FROM user_directory WHERE user_id = $1`,
        [input.authorId],
      )).rows[0]?.name ?? 'Một người dùng';

      const notifications: ThreadNotification[] = [];
      for (const { user_id: userId } of recipients.rows) {
        const notification = await this.upsertThreadRow(client, { ...input, rootId, userId, actorName });
        if (notification) notifications.push(notification);
      }
      return notifications;
    }, input.postId);
  }

  private async upsertThreadRow(
    client: pg.PoolClient,
    input: {
      commentId: string; postId: string; authorId: string; rootId: string; userId: string;
      actorName: string; eventId: string; occurredAt: string; commentBody?: string;
    },
  ): Promise<ThreadNotification | null> {
    const link = `/trips/${input.postId}?comment=${input.commentId}`;
    const key = `${input.userId}:${THREAD_REPLY_TYPE}:${input.rootId}:`;
    const unread = (await client.query<{ id: string; data: { commentId?: string; actorIds?: string[] } }>(
      `SELECT id, data FROM inbox WHERE group_key COLLATE "C" >= $1 AND group_key COLLATE "C" < $2
         AND read_at IS NULL AND deleted_at IS NULL AND NOT is_post_interaction_suppressed
       ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [key, key + '~'],
    )).rows[0];

    if (unread) {
      // Sự kiện gửi lại: dòng đã có bình luận này thì không đổi gì.
      if (unread.data.commentId === input.commentId) return null;
      const actorIds = [...new Set([...(unread.data.actorIds ?? []), input.authorId])];
      const { rows } = await client.query<InboxRow>(
        `UPDATE inbox SET body = $2, link = $3, comment_id = $4, interaction_occurred_at = $5,
           data = data || $6::jsonb
         WHERE id = $1 RETURNING *`,
        [unread.id, threadReplyBody(input.actorName, actorIds.length), link, input.commentId, input.occurredAt,
          JSON.stringify({ commentId: input.commentId, actorIds, excerpt: toCommentExcerpt(input.commentBody) ?? null })],
      );
      return rows[0] ? { row: rows[0], isNew: false } : null;
    }

    const { rows } = await client.query<InboxRow>(
      `INSERT INTO inbox (user_id, type, title, body, link, data, source_event_id, comment_id, group_key, interaction_occurred_at)
       VALUES ($1, $2, 'Có trả lời mới trong luồng', $3, $4, $5::jsonb, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING RETURNING *`,
      [input.userId, THREAD_REPLY_TYPE, threadReplyBody(input.actorName, 1), link,
        JSON.stringify({
          postId: input.postId, commentId: input.commentId, parentCommentId: input.rootId, actorIds: [input.authorId],
          excerpt: toCommentExcerpt(input.commentBody),
        }),
        input.eventId, input.commentId, key + input.eventId, input.occurredAt],
    );
    return rows[0] ? { row: rows[0], isNew: true } : null;
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
