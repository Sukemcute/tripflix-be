import type { ReasonCode } from './reason-codes.js';
import type { RuleHit } from './rules.js';
/** Ngưỡng hồ sơ "khẩn cấp" trên màn kiểm duyệt, khớp nhãn đỏ của Admin. */
export const URGENT_SEVERITY = 80;
export interface AiVerdict {
  id: string;
  flagged: boolean;
  categories: Record<string, boolean>;
  scores: Record<string, number>;
  model: string;
}
export interface SeverityConfig {
  aiThreshold: number;
  reportThreshold: number;
}
export interface SeverityVerdict {
  severity: number;
  shouldAutoHide: boolean;
  suspicious: boolean;
  /** Lý do ghi vào quyết định tự ẩn; null khi không tự ẩn. */
  autoHideReason: ReasonCode | null;
}

// Luật đủ rõ nghĩa để tự ẩn ngay; tác giả vẫn khiếu nại được. SĐT/link đơn lẻ chỉ vào hàng chờ.
const AUTO_HIDE_RULES: Record<string, ReasonCode> = {
  SCAM_PATTERN: 'SCAM',
  EXTREMISM: 'EXTREMISM',
  THREAT: 'VIOLENCE',
  PROFANITY: 'HARASSMENT',
};
// Nhãn AI (OpenAI + ViSoBERT) tự ẩn khi đủ điểm, theo thứ tự ưu tiên lý do.
const AI_AUTO_HIDE_LABELS: Array<[RegExp, ReasonCode]> = [
  [/^sexual(?:\/minors)?$/, 'SEXUAL'],
  [/^(?:violence\/graphic|hate\/threatening|illicit\/violent|harassment\/threatening)$/, 'VIOLENCE'],
  [/^self-harm(?:\/.*)?$/, 'OTHER'],
  [/^(?:harassment|hate)$/, 'HARASSMENT'],
];
// ViSoBERT đã áp ngưỡng riêng ở tripflix-ai trước khi trả categories.
const VISOBERT_TOXIC = 'visobert/toxic';

function findAiAutoHideReason(ai: AiVerdict | null, config: SeverityConfig): ReasonCode | null {
  if (!ai?.flagged) return null;
  for (const [pattern, reason] of AI_AUTO_HIDE_LABELS) {
    const isHit = Object.entries(ai.scores).some(
      ([label, score]) => pattern.test(label) && ai.categories[label] === true && score >= config.aiThreshold,
    );
    if (isHit) return reason;
  }
  return ai.categories[VISOBERT_TOXIC] === true ? 'HARASSMENT' : null;
}

export function evaluateSeverity(
  rules: RuleHit[],
  ai: AiVerdict | null,
  reportCount: number,
  config: SeverityConfig,
): SeverityVerdict {
  const ruleReason =
    Object.entries(AUTO_HIDE_RULES).find(([code]) => rules.some((hit) => hit.code === code))?.[1] ?? null;
  const autoHideReason = ruleReason ?? findAiAutoHideReason(ai, config);
  const shouldAutoHide = autoHideReason !== null;
  const severity = Math.min(
    100,
    Math.max(
      0,
      ...rules.map((hit) => hit.weight),
      ai?.flagged ? 60 : 0,
      reportCount * 15,
      shouldAutoHide ? 90 : 0,
    ),
  );
  return {
    severity,
    shouldAutoHide,
    suspicious: rules.length > 0 || Boolean(ai?.flagged) || reportCount > 0,
    autoHideReason,
  };
}
