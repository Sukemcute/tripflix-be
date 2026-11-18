import type { AiBucket, AiTimePoint, AiTraceRow, AiTraceStep, AiUserUsageRow, AiWindow } from '../domain/ai-insights.js';

export const AI_INSIGHTS_STORE = Symbol('AI_INSIGHTS_STORE');

export interface AiTraceFilter {
  userId?: string | undefined;
  answerKind?: string | undefined;
  minCostUsd?: number | undefined;
}

/** Đọc chi phí và trace AI cho trang quản trị (SCRUM-179). Chỉ đọc bảng analytics. */
export interface AiInsightsStore {
  timeseries(query: AiWindow & { bucket: AiBucket; feature?: string | undefined; model?: string | undefined }): Promise<AiTimePoint[]>;
  /** Người dùng có lượt gọi AI trong cửa sổ, tốn nhiều nhất trước. `total` là số người, không tính phân trang. */
  userRanking(query: AiWindow & { userId?: string | undefined; limit: number; offset: number }): Promise<{ rows: AiUserUsageRow[]; total: number }>;
  traceList(query: AiWindow & AiTraceFilter & { limit: number; offset: number }): Promise<{ rows: AiTraceRow[]; total: number }>;
  /** Null khi không có lượt chat nào với turnId này. */
  traceDetail(turnId: string): Promise<{ trace: AiTraceRow; steps: AiTraceStep[] } | null>;
  /** Bỏ liên kết người dùng, cuộc trò chuyện và lượt chat ở dòng cũ hơn `cutoff`, giữ số liệu tổng. Trả về số dòng đã sửa. */
  unlinkBefore(cutoff: Date): Promise<number>;
}
