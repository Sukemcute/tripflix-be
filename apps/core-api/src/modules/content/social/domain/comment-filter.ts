/** Case/accent insensitive Vietnamese phrase matching; punctuation separates words. */
export function normalizeCommentKeyword(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchesCommentKeywords(body: string, keywords: readonly string[]): boolean {
  const normalized = ` ${normalizeCommentKeyword(body)} `;
  return keywords.some((keyword) => {
    const term = normalizeCommentKeyword(keyword);
    return Boolean(term) && normalized.includes(` ${term} `);
  });
}
