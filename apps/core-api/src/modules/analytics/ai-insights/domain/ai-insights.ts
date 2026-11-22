export const AI_BUCKETS = ['hour', 'day'] as const;
export type AiBucket = (typeof AI_BUCKETS)[number];

/** Bucket theo giờ chỉ cho khoảng ngắn để biểu đồ không quá nhiều điểm. */
export const MAX_HOUR_BUCKET_DAYS = 8;

const BUCKET_MS: Record<AiBucket, number> = { hour: 3_600_000, day: 86_400_000 };
// Việt Nam UTC+7 quanh năm, không có giờ mùa hè.
const VN_OFFSET_MS = 7 * 3_600_000;

/** Đầu bucket (giờ hoặc ngày theo giờ Việt Nam) chứa thời điểm `at`. */
export function bucketStart(at: Date, bucket: AiBucket): Date {
  const size = BUCKET_MS[bucket];
  return new Date(Math.floor((at.getTime() + VN_OFFSET_MS) / size) * size - VN_OFFSET_MS);
}

export interface AiTimePoint {
  at: Date;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Điền 0 cho bucket không có dữ liệu trong [from, to) để biểu đồ liên tục. */
export function fillBuckets(points: readonly AiTimePoint[], from: Date, to: Date, bucket: AiBucket): AiTimePoint[] {
  const size = BUCKET_MS[bucket];
  const byTime = new Map(points.map((point) => [point.at.getTime(), point]));
  const filled: AiTimePoint[] = [];
  for (let at = bucketStart(from, bucket).getTime(); at < to.getTime(); at += size) {
    filled.push(byTime.get(at) ?? { at: new Date(at), calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  }
  return filled;
}

export interface AiUserUsageRow {
  userId: string;
  calls: number;
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  lastAt: Date;
}

/** Một lượt chat: câu hỏi đã che từ ai.chat.turn.recorded, cộng token và chi phí của các bước gọi LLM cùng turnId. */
export interface AiTraceRow {
  eventId: string;
  /** Null với lượt chat cũ chưa có turnId: không có các bước chi tiết. */
  turnId: string | null;
  userId: string;
  occurredAt: Date;
  question: string | null;
  intent: string | null;
  answerKind: string | null;
  isAction: boolean;
  latencyMs: number | null;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiTraceStep {
  id: string;
  step: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  latencyMs: number | null;
  occurredAt: Date;
  isEstimated: boolean;
}

export interface AiWindow {
  from: Date;
  to: Date;
}
