import {
  ContentMediaFailedV1Schema,
  ContentMediaReadyV1Schema,
  ContentPostHiddenV1Schema,
  ContentPostRestoredV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import { toInboxItemDto, type InboxRepository, type InboxRow } from '../../inbox/inbox.repository.js';
import type { PostNotificationRepository } from '../../inbox/post-notification.repository.js';
import type { RealtimeService } from '../../realtime/realtime.service.js';
import type { EventHandler } from './event-handler.js';

const REASONS = new Map([
  ['SPAM_OR_COMMERCIAL', 'Spam hoặc quảng cáo'],
  ['SCAM', 'Lừa đảo'],
  ['HARASSMENT', 'Quấy rối'],
  ['SEXUAL', 'Nội dung tình dục'],
  ['VIOLENCE', 'Bạo lực'],
  ['MISINFORMATION', 'Thông tin sai lệch'],
  ['OTHER', 'Vi phạm quy định cộng đồng'],
]);

export function createContentStatusHandlers(options: {
  inbox: Pick<InboxRepository, 'insert' | 'countUnread'>;
  posts?: Pick<PostNotificationRepository, 'moderate'>;
  realtime?: Pick<RealtimeService, 'emitToUser'>;
  log: (message: string, event: EventEnvelope) => void;
}): Record<string, EventHandler> {
  const { inbox, posts, realtime, log } = options;

  async function emit(event: EventEnvelope, userId: string, row?: InboxRow): Promise<void> {
    if (!realtime) return;
    try {
      const unreadCount = await inbox.countUnread(userId);
      if (row) realtime.emitToUser(userId, 'notification.created', { item: toInboxItemDto(row), unreadCount });
      else realtime.emitToUser(userId, 'notification.read', { unreadCount });
    } catch {
      log('Không phát được cập nhật trạng thái nội dung', event);
    }
  }

  async function moderate(event: EventEnvelope): Promise<boolean> {
    if (!posts) return false;
    const isHidden = event.type === 'content.post.hidden';
    const schema = isHidden ? ContentPostHiddenV1Schema : ContentPostRestoredV1Schema;
    const { postId, authorId, actionId, postStatus, reasonCode, hiddenAt } = schema.parse(event.payload);
    if (isHidden ? !['hidden', 'removed'].includes(postStatus) : postStatus !== 'published') return false;
    const status = isHidden ? postStatus : 'restored';
    const title = status === 'restored' ? 'Bài viết đã được khôi phục'
      : status === 'removed' ? 'Bài viết đã bị gỡ' : 'Bài viết đã bị ẩn';
    const reason = REASONS.get(reasonCode);
    const { row, invalidatedUsers } = await posts.moderate({
      postId,
      occurredAt: hiddenAt,
      isHidden,
      item: {
        userId: authorId,
        type: `moderation.post.${status}`,
        title,
        body: isHidden ? `${title}. Lý do: ${reason ?? 'Vi phạm quy định cộng đồng'}.`
          : 'Bài viết của bạn đã hiển thị trở lại.',
        link: isHidden ? null : `/trips/${postId}`,
        data: { postId, ...(reason ? { reasonCode } : {}) },
        sourceEventId: `moderation:${actionId}`,
      },
    });
    await Promise.all([
      ...(row ? [emit(event, row.user_id, row)] : []),
      ...invalidatedUsers.filter((userId) => userId !== row?.user_id).map((userId) => emit(event, userId)),
    ]);
    return true;
  }

  async function video(event: EventEnvelope): Promise<boolean> {
    const isReady = event.type === 'content.media.ready';
    const schema = isReady ? ContentMediaReadyV1Schema : ContentMediaFailedV1Schema;
    const { ownerId, assetId } = schema.parse(event.payload);
    const row = await inbox.insert({
      userId: ownerId,
      type: isReady ? 'media.ready' : 'media.failed',
      title: isReady ? 'Video đã sẵn sàng' : 'Không xử lý được video',
      body: isReady ? 'Video bạn tải lên đã có thể phát.' : 'Bạn có thể thử tải video lên lại.',
      link: null,
      data: { assetId },
      sourceEventId: event.eventId,
    });
    if (row) await emit(event, ownerId, row);
    return true;
  }

  return {
    'content.post.hidden.v1': moderate,
    'content.post.restored.v1': moderate,
    'content.media.ready.v1': video,
    'content.media.failed.v1': video,
  };
}
