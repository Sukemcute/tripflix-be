import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mọi bảng của module analytics khai báo trong schema này. */
export const analyticsSchema = pgSchema('analytics');

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Mỗi lần ai-service gọi LLM hoặc kiểm duyệt (sự kiện `ai.usage.recorded` trên stream:ai, TF95).
 * Khoá chính là eventId: sự kiện giao lại không đếm trùng. Không lưu userId: báo cáo chi phí không cần biết ai.
 */
export const aiUsageEvents = analyticsSchema.table(
  'ai_usage_events',
  {
    id: uuid('id').primaryKey(),
    occurredAt: at('occurred_at').notNull(),
    feature: text('feature').notNull(),
    step: text('step'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd').notNull(),
    isEstimated: boolean('is_estimated').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('idx_ai_usage_events_occurred_at').on(t.occurredAt)],
);

/**
 * Hành vi từng người dùng (TF177), gom từ sự kiện content, app-events và ai.chat.turn.recorded.
 * Khoá chính là eventId nên giao lại không đếm trùng. Giữ 90 ngày (job dọn dẹp trong module).
 * detail chỉ chứa thông tin cần cho trang: chat có câu hỏi đã che thông tin cá nhân (TF177).
 */
export const userActivityEvents = analyticsSchema.table(
  'user_activity_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    occurredAt: at('occurred_at').notNull(),
    targetId: uuid('target_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_user_activity_events_user_occurred').on(t.userId, t.occurredAt),
    index('idx_user_activity_events_occurred').on(t.occurredAt),
  ],
);
