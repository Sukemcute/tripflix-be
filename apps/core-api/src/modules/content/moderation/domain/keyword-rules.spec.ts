import { expect, it } from 'vitest';
import { matchModerationKeywords } from './keyword-rules.js';
import { evaluateSeverity } from './severity.js';

it('khớp cụm đã chuẩn hóa theo ranh giới từ và chỉ chuyển vào hàng chờ', () => {
  const rules = [{ keyword: 'Ví dụ du lịch', normalizedKeyword: 'vi du du lich' }];
  const hits = matchModerationKeywords('VI DỤ, du lịch!', rules);
  expect(hits).toEqual([{ code: 'CUSTOM_KEYWORD', category: 'OTHER', match: 'Ví dụ du lịch', weight: 60 }]);
  expect(matchModerationKeywords('xvi du du lich', rules)).toEqual([]);
  expect(evaluateSeverity(hits, null, 0, { aiThreshold: 0.8, reportThreshold: 3 })).toMatchObject({
    suspicious: true,
    shouldAutoHide: false,
  });
});
