import { boolean, doublePrecision, index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
