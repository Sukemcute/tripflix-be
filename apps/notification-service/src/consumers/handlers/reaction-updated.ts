import {
  ContentCommentReactionUpdatedV1Schema,
  ContentReactionUpdatedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import type { ReactionChange, ReactionNotificationRepository } from '../../grouping/reaction-notification.repository.js';
import { toInboxItemDto, type InboxRepository } from '../../inbox/inbox.repository.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import type { EventHandler } from './event-handler.js';

export function createReactionHandlers(options: {
  reactions: Pick<ReactionNotificationRepository, 'apply'>;
  inbox: Pick<InboxRepository, 'countUnread'> | undefined;
  realtime: Pick<RealtimeService, 'emitToUser'> | undefined;
  log: (message: string, event: EventEnvelope) => void;
}): Record<string, EventHandler> {
  async function apply(event: EventEnvelope, change: Omit<ReactionChange, 'eventId' | 'occurredAt'>): Promise<boolean> {
    const result = await options.reactions.apply({ ...change, eventId: event.eventId, occurredAt: event.occurredAt });
    if (result && options.inbox && options.realtime) {
      const { row, isNew } = result;
      try {
        const unreadCount = await options.inbox.countUnread(row.user_id);
        if (isNew) {
          options.realtime.emitToUser(row.user_id, 'notification.created', { item: toInboxItemDto(row), unreadCount });
        } else {
          // Web TF46C nghe sự kiện này để tải lại inbox và badge.
          options.realtime.emitToUser(row.user_id, 'notification.read', { unreadCount });
        }
      } catch {
        options.log('Không phát được cập nhật thông báo cảm xúc', event);
      }
    }
    return true;
  }

  return {
    'content.reaction.updated.v1': (event) => {
      const { postId, postAuthorId, userId, type } = ContentReactionUpdatedV1Schema.parse(event.payload);
      return apply(event, { postId, ownerId: postAuthorId, actorId: userId, isActive: type !== null });
    },
    'content.comment_reaction.updated.v1': (event) => {
      const { postId, commentId, commentAuthorId, userId, isLiked } =
        ContentCommentReactionUpdatedV1Schema.parse(event.payload);
      return apply(event, { postId, commentId, ownerId: commentAuthorId, actorId: userId, isActive: isLiked });
    },
  };
}
