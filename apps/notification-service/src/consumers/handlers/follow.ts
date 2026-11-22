import type { EventEnvelope } from '@tripflix/contracts';
import { z } from 'zod';
import type { FollowerPostWorker } from '../../inbox/follower-post.worker.js';
import { toInboxItemDto, type InboxRepository } from '../../inbox/inbox.repository.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import type { EventHandler } from './event-handler.js';

const FollowChangedSchema = z.object({ followerId: z.uuid(), authorId: z.uuid(), followedAt: z.iso.datetime().nullable() });

export function createFollowHandlers(options: {
  followerPosts: Pick<FollowerPostWorker, 'applyFollow'>;
  inbox: Pick<InboxRepository, 'countUnread'> | undefined;
  realtime: Pick<RealtimeService, 'emitToUser'> | undefined;
  log: (message: string, event: EventEnvelope) => void;
}): Record<string, EventHandler> {
  return {
    'content.follow.changed.v1': async (event) => {
      const change = FollowChangedSchema.parse(event.payload);
      const row = await options.followerPosts.applyFollow({ ...change, changedAt: event.occurredAt });
      if (row && options.inbox && options.realtime) {
        try {
          const unreadCount = await options.inbox.countUnread(row.user_id);
          options.realtime.emitToUser(row.user_id, 'notification.created', { item: toInboxItemDto(row), unreadCount });
        } catch {
          options.log('Không phát được thông báo realtime', event);
        }
      }
      return true;
    },
  };
}
