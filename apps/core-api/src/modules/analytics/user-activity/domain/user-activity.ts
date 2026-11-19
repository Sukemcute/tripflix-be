import {
  AiChatTurnRecordedV1Schema,
  ContentCommentCreatedV1Schema,
  ContentPostSharedV1Schema,
  ContentPostViewedV1Schema,
  ContentReactionUpdatedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';

export const USER_ACTIVITY_KINDS = ['reaction', 'comment', 'share', 'view', 'chat'] as const;
export type UserActivityKind = (typeof USER_ACTIVITY_KINDS)[number];

/** Dữ liệu hành vi giữ tối đa 90 ngày (TF177). */
export const USER_ACTIVITY_RETENTION_DAYS = 90;
export const DAY_MS = 86_400_000;

export interface UserActivityRecord {
  id: string;
  userId: string;
  kind: UserActivityKind;
  occurredAt: Date;
  targetId: string | null;
  detail: Record<string, unknown>;
}

/** Mốc cắt dữ liệu: mọi bản ghi trước mốc này bị xoá. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - USER_ACTIVITY_RETENTION_DAYS * DAY_MS);
}

/**
 * Đổi một sự kiện thành dòng hành vi. Sự kiện khác loại, hoặc không tính là hành vi (bỏ thích, khách, xem chưa đủ điều kiện) thì `null`.
 * Sự kiện đúng loại nhưng sai hợp đồng thì ném ZodError để consumer ghi log rồi bỏ qua.
 */
export function toUserActivityRecord(event: EventEnvelope): UserActivityRecord | null {
  const base = { id: event.eventId, occurredAt: new Date(event.occurredAt) };
  switch (event.type) {
    case 'content.reaction.updated': {
      const payload = ContentReactionUpdatedV1Schema.parse(event.payload);
      // type null là bỏ thích, không tính.
      if (payload.type === null) return null;
      return { ...base, userId: payload.userId, kind: 'reaction', targetId: payload.postId, detail: { reaction: payload.type } };
    }
    case 'content.comment.created': {
      const payload = ContentCommentCreatedV1Schema.parse(event.payload);
      return { ...base, userId: payload.authorId, kind: 'comment', targetId: payload.postId, detail: {} };
    }
    case 'content.post.shared': {
      const payload = ContentPostSharedV1Schema.parse(event.payload);
      if (payload.userId === null) return null;
      return { ...base, userId: payload.userId, kind: 'share', targetId: payload.postId, detail: {} };
    }
    case 'content.post.viewed': {
      const payload = ContentPostViewedV1Schema.parse(event.payload);
      // Chỉ tính người đã đăng nhập và xem đủ điều kiện (isQualified).
      if (payload.viewerId === null || !payload.isQualified) return null;
      return {
        ...base,
        userId: payload.viewerId,
        kind: 'view',
        targetId: payload.postId,
        detail: { watchedMs: payload.watchedMs, surface: payload.surface },
      };
    }
    case 'ai.chat.turn.recorded': {
      const parsed = AiChatTurnRecordedV1Schema.parse(event);
      return {
        id: parsed.eventId,
        occurredAt: new Date(parsed.occurredAt),
        userId: parsed.userId,
        kind: 'chat',
        targetId: null,
        detail: {
          conversationId: parsed.payload.conversationId,
          question: parsed.payload.question,
          intent: parsed.payload.intent,
          answerKind: parsed.payload.answerKind,
          isAction: parsed.payload.isAction,
          // Có từ ai-service bản mới (SCRUM-179); sự kiện cũ không có thì bỏ khoá, không ghi null.
          ...(parsed.payload.turnId ? { turnId: parsed.payload.turnId } : {}),
          ...(typeof parsed.payload.latencyMs === 'number' ? { latencyMs: parsed.payload.latencyMs } : {}),
        },
      };
    }
    default:
      return null;
  }
}

/** Cửa sổ thời gian [from, to): from gồm, to không gồm. */
export interface UserActivityWindow {
  from: Date;
  to: Date;
}

export interface UserActivityCounts {
  reactions: number;
  comments: number;
  shares: number;
  views: number;
  chats: number;
  lastActiveAt: Date | null;
}
