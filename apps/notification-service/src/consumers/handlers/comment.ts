import { ContentCommentCreatedV1Schema, ContentCommentDeletedV1Schema, type EventEnvelope } from '@tripflix/contracts';
import type { CommentNotificationRepository } from '../../inbox/comment-notification.repository.js';
import { toInboxItemDto, type InboxRepository } from '../../inbox/inbox.repository.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import type { EventHandler } from './event-handler.js';

export function createCommentHandlers(options: {
  comments: Pick<CommentNotificationRepository, 'create' | 'hide'>;
  inbox: Pick<InboxRepository, 'countUnread'> | undefined;
  realtime: Pick<RealtimeService, 'emitToUser'> | undefined;
  log: (message: string, event: EventEnvelope) => void;
}): Record<string, EventHandler> {
  async function emit(event: EventEnvelope, userId: string, name: string, data: Record<string, unknown>): Promise<void> {
    const { inbox, realtime } = options;
    if (!inbox || !realtime) return;
    try {
      const unreadCount = await inbox.countUnread(userId);
      realtime.emitToUser(userId, name, { ...data, unreadCount });
    } catch {
      options.log('Không phát được cập nhật thông báo bình luận', event);
    }
  }

  return {
    'content.comment.created.v1': async (event) => {
      const comment = ContentCommentCreatedV1Schema.parse(event.payload);
      const recipients = new Map([[comment.postAuthorId, false]]);
      const replyRecipient = comment.replyToAuthorId ?? comment.parentCommentAuthorId;
      if (comment.parentCommentId && replyRecipient) {
        recipients.set(replyRecipient, true);
      }
      recipients.delete(comment.authorId);
      if (!recipients.size) return true;
      const rows = await options.comments.create({
        commentId: comment.commentId,
        postId: comment.postId,
        authorId: comment.authorId,
        authorDisplayName: comment.authorDisplayName,
        parentCommentId: comment.parentCommentId,
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        recipients: Array.from(recipients, ([userId, isReplyRecipient]) => ({ userId, isReplyRecipient })),
      });
      await Promise.all(rows.map((row) => emit(event, row.user_id, 'notification.created', { item: toInboxItemDto(row) })));
      return true;
    },
    'content.comment.deleted.v1': async (event) => {
      const { commentId, deletedAt } = ContentCommentDeletedV1Schema.parse(event.payload);
      const recipients = await options.comments.hide(commentId, deletedAt);
      // Làm mới inbox và số chưa đọc qua tín hiệu mà Web TF46C đã hỗ trợ.
      await Promise.all(recipients.map((userId) => emit(event, userId, 'notification.read', {})));
      return true;
    },
  };
}
