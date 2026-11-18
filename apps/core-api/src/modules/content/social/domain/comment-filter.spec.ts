import { matchesCommentKeywords, normalizeCommentKeyword } from './comment-filter.js';

describe('creator keyword filter', () => {
  it('matches Vietnamese phrases independent of case, accents, whitespace and punctuation', () => {
    expect(matchesCommentKeywords('Xin ĐẶT-CỌC, ở đây', ['đặt cọc'])).toBe(true);
    expect(normalizeCommentKeyword('  Đặt   Cọc! ')).toBe('dat coc');
  });
  it('matches full terms, not unrelated substrings or punctuation-only keywords', () => {
    expect(matchesCommentKeywords('tôi đặt phòng ở đây', ['phố', '!!!'])).toBe(false);
    expect(matchesCommentKeywords('khách sạn tốt', [])).toBe(false);
  });
});
