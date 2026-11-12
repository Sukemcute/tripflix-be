import {
  AccessUserGuestMergedV1Schema,
  AccessUserLockedV1Schema,
  AccessUserRegisteredV1Schema,
  CommerceOrderCancelledV1Schema,
  CommerceOrderPaidV1Schema,
  ContentCommentCreatedV1Schema,
  ContentCommentDeletedV1Schema,
  DiscoverySearchPerformedV1Schema,
  DiscoveryStaysSearchedV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';
import { z, type ZodType } from 'zod';
import type { Kind, RawRow } from '../contracts.js';

// Payload đang phát nhưng chưa có schema trong libs/contracts: chép đúng outbox.add của content.
// Chuyển sang libs/contracts khi PR B (duy/TF28-schema-su-kien-content) xong.
const ReactionUpdatedSchema = z.object({ postId: z.uuid(), userId: z.uuid(), type: z.string().nullable() });
const PostSharedSchema = z.object({ postId: z.uuid(), userId: z.uuid().nullable() });
const PostPublishedSchema = z.object({ postId: z.uuid(), authorId: z.uuid(), postType: z.string() });
const CommentReactionUpdatedSchema = z.object({ commentId: z.uuid(), postId: z.uuid(), userId: z.uuid(), isLiked: z.boolean() });

type Row = Omit<RawRow, 'actorType' | 'occurredAt' | 'targetType' | 'targetId' | 'value' | 'isRemoved' | 'detail'> &
  Partial<Pick<RawRow, 'targetType' | 'targetId' | 'value' | 'isRemoved' | 'detail'>>;

/** Ánh xạ từng loại sự kiện: schema payload + hàm đổi sang dòng thô. */
const MAPPERS: Record<string, { schema: ZodType; toRows: (p: never, e: EventEnvelope) => Row[] }> = {};
function on<S extends ZodType>(type: string, schema: S, toRows: (p: z.infer<S>, e: EventEnvelope) => Row[]) {
  MAPPERS[type] = { schema, toRows: toRows as (p: never, e: EventEnvelope) => Row[] };
}
const user = (actorId: string, kind: Kind, refId: string, rest: Partial<Row> = {}): Row => ({ actorId, kind, refId, ...rest });

on('content.reaction.updated', ReactionUpdatedSchema, (p) => [
  // Gỡ cảm xúc: set-reaction ghi type = null.
  user(p.userId, 'reaction', p.postId, { targetType: 'post', targetId: p.postId, isRemoved: p.type === null, detail: { type: p.type } }),
]);
on('content.post.shared', PostSharedSchema, (p, e) =>
  p.userId ? [user(p.userId, 'share', e.eventId, { targetType: 'post', targetId: p.postId })] : [],
);
on('content.post.published', PostPublishedSchema, (p) => [
  user(p.authorId, 'publish', p.postId, { targetType: 'post', targetId: p.postId, detail: { postType: p.postType } }),
]);
on('content.comment_reaction.updated', CommentReactionUpdatedSchema, (p) => [
  user(p.userId, 'comment_reaction', p.commentId, { targetType: 'comment', targetId: p.commentId, isRemoved: !p.isLiked, detail: { postId: p.postId } }),
]);
// Không lưu body bình luận.
on('content.comment.created', ContentCommentCreatedV1Schema, (p) => [
  user(p.authorId, 'comment', p.commentId, { targetType: 'post', targetId: p.postId, detail: { parentCommentId: p.parentCommentId } }),
]);
on('content.comment.deleted', ContentCommentDeletedV1Schema, (p) => [
  user(p.authorId, 'comment', p.commentId, { targetType: 'post', targetId: p.postId, isRemoved: true, detail: { parentCommentId: p.parentCommentId } }),
]);
// Không lưu tên, liên hệ, guests.
on('commerce.order.paid', CommerceOrderPaidV1Schema, (p) =>
  p.items.map((item, index) =>
    user(p.userId, 'order_item', `${p.orderId}:${index}`, {
      targetType: item.productType,
      targetId: item.productId,
      detail: {
        orderId: p.orderId,
        sourcePostId: p.sourcePostId,
        date: item.date,
        nights: item.nights,
        qty: item.qty,
        flight: item.flight ? { fromAirport: item.flight.fromAirport, toAirport: item.flight.toAirport } : null,
      },
    }),
  ),
);
on('access.user.registered', AccessUserRegisteredV1Schema, (p) => [user(p.userId, 'registered', p.userId)]);
on('access.user.guest_merged', AccessUserGuestMergedV1Schema, (p) => [
  user(p.userId, 'guest_merged', p.anonId, { targetType: 'anon', targetId: p.anonId }),
]);
on('access.user.locked', AccessUserLockedV1Schema, (p) => [user(p.userId, 'locked', p.userId)]);
on('discovery.search.performed', DiscoverySearchPerformedV1Schema, (p, e) => {
  const placeId = p.placeIds[0] ?? null;
  return [
    user(p.userId, 'search', e.eventId, {
      targetType: placeId ? 'place' : null,
      targetId: placeId,
      detail: { placeIds: p.placeIds, intent: p.intent, budgetMax: p.budgetMax, surface: p.surface, postType: p.postType },
    }),
  ];
});
on('discovery.stays.searched', DiscoveryStaysSearchedV1Schema, (p, e) => [
  user(p.userId, 'stays_search', e.eventId, {
    targetType: 'place',
    targetId: p.placeId,
    detail: { checkIn: p.checkIn, checkOut: p.checkOut, adults: p.adults, rooms: p.rooms, minStars: p.minStars, priceMax: p.priceMax },
  }),
]);

/**
 * Sự kiện → 0..n dòng thô (đề xuất mục 3.4). `null` = payload hỏng (bên gọi log warn rồi bỏ để XACK).
 * Loại không biết hoặc version khác 1 → [].
 */
export function toRawRows(event: EventEnvelope): RawRow[] | null {
  const mapper = MAPPERS[event.type];
  if (!mapper || event.version !== 1) return [];
  const parsed = mapper.schema.safeParse(event.payload);
  if (!parsed.success) return null;
  return mapper.toRows(parsed.data as never, event).map((r) => ({
    actorType: 'user',
    targetType: null,
    targetId: null,
    value: null,
    isRemoved: false,
    detail: null,
    ...r,
    occurredAt: event.occurredAt,
  }));
}

export interface OrderCancellation {
  userId: string;
  orderId: string;
  occurredAt: string;
}

/**
 * commerce.order.cancelled không mang items nên không upsert từng dòng được: bên gọi đánh dấu gỡ mọi dòng
 * order_item `orderId:*` của người đó. `null` = payload hỏng; không phải sự kiện huỷ → undefined.
 */
export function toOrderCancellation(event: EventEnvelope): OrderCancellation | null | undefined {
  if (event.type !== 'commerce.order.cancelled' || event.version !== 1) return undefined;
  const parsed = CommerceOrderCancelledV1Schema.safeParse(event.payload);
  return parsed.success ? { userId: parsed.data.userId, orderId: parsed.data.orderId, occurredAt: event.occurredAt } : null;
}
