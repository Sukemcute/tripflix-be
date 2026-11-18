import type { EventEnvelope } from '@tripflix/contracts';
import { z } from 'zod';

/** Sự kiện ai-service phát sau mỗi lần gọi LLM hoặc kiểm duyệt (hợp đồng ở tripflix-ai: app/services/usage_events.py). */
export const AI_USAGE_EVENT = 'ai.usage.recorded';
export const AI_FEATURES = ['chat', 'summary', 'moderation'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const AI_USAGE_GROUPS = ['feature', 'day', 'model'] as const;
export type AiUsageGroup = (typeof AI_USAGE_GROUPS)[number];

const tokens = z.number().int().nonnegative().nullable().optional();
const AiUsagePayloadSchema = z.object({
  feature: z.enum(AI_FEATURES),
  model: z.string().min(1).max(100),
  step: z.string().min(1).max(30).optional(),
  inputTokens: tokens,
  outputTokens: tokens,
  costUsd: z.number().nonnegative().finite(),
  estimated: z.boolean(),
  // SCRUM-179: tuỳ chọn, chỉ có từ ai-service bản mới; chat có conversationId, tóm tắt và kiểm duyệt thì không.
  conversationId: z.uuid().optional(),
  turnId: z.uuid().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

export interface AiUsageRecord {
  id: string;
  occurredAt: Date;
  feature: AiFeature;
  step: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  isEstimated: boolean;
  /** Người dùng gây ra lượt gọi (chat); null với tóm tắt, kiểm duyệt và sự kiện cũ. */
  userId: string | null;
  conversationId: string | null;
  turnId: string | null;
  latencyMs: number | null;
}

export interface AiUsageQuery {
  from: Date;
  to: Date;
  groupBy: AiUsageGroup;
}

export interface AiUsageRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Sự kiện khác loại thì `null`; payload sai hợp đồng thì ném, để consumer ghi log rồi bỏ qua. */
export function toAiUsageRecord(event: EventEnvelope): AiUsageRecord | null {
  if (event.type !== AI_USAGE_EVENT) return null;
  const payload = AiUsagePayloadSchema.parse(event.payload);
  return {
    id: event.eventId,
    occurredAt: new Date(event.occurredAt),
    feature: payload.feature,
    step: payload.step ?? null,
    model: payload.model,
    inputTokens: payload.inputTokens ?? null,
    outputTokens: payload.outputTokens ?? null,
    costUsd: payload.costUsd,
    isEstimated: payload.estimated,
    userId: event.userId ?? null,
    conversationId: payload.conversationId ?? null,
    turnId: payload.turnId ?? null,
    latencyMs: payload.latencyMs ?? null,
  };
}

/** Cộng các nhóm thành dòng tổng. */
export function sumAiUsage(rows: readonly AiUsageRow[]): Omit<AiUsageRow, 'key'> {
  return rows.reduce(
    (total, row) => ({
      calls: total.calls + row.calls,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      costUsd: total.costUsd + row.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}
