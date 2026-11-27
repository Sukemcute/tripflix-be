import { normalizeCommentKeyword } from '../../social/domain/comment-filter.js';
import type { RuleHit } from './rules.js';

export function matchModerationKeywords(
  text: string,
  rules: readonly { keyword: string; normalizedKeyword: string }[],
): RuleHit[] {
  const normalized = ` ${normalizeCommentKeyword(text)} `;
  return rules
    .filter((rule) => normalized.includes(` ${rule.normalizedKeyword} `))
    .map((rule) => ({ code: 'CUSTOM_KEYWORD', category: 'OTHER', match: rule.keyword, weight: 60 }));
}
