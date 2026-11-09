import type { RuleHit } from './rules.js';
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
export function evaluateSeverity(
  rules: RuleHit[],
  ai: AiVerdict | null,
  reportCount: number,
  config: SeverityConfig,
) {
  const dangerous =
    /^(?:sexual(?:\/minors)?|violence\/graphic|self-harm(?:\/.*)?|hate\/threatening|illicit\/violent)$/;
  const aiHide = Boolean(
    ai?.flagged &&
    Object.entries(ai.scores).some(
      ([label, score]) =>
        dangerous.test(label) && ai.categories[label] === true && score >= config.aiThreshold,
    ),
  );
  const shouldAutoHide =
    aiHide || rules.some((hit) => hit.code === 'SCAM_PATTERN') || reportCount >= config.reportThreshold;
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
  };
}
