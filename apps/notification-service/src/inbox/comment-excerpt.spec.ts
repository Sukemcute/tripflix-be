import { expect, it } from 'vitest';
import { toCommentExcerpt } from './comment-notification.repository.js';

it('đoạn trích gộp khoảng trắng và cắt ở 100 ký tự kể cả emoji', () => {
  expect(toCommentExcerpt('  Đẹp\n\nquá   trời ')).toBe('Đẹp quá trời');
  expect(toCommentExcerpt('   ')).toBeUndefined();
  expect(toCommentExcerpt(undefined)).toBeUndefined();
  const excerpt = toCommentExcerpt('😀'.repeat(150));
  expect(Array.from(excerpt!)).toHaveLength(100);
  expect(excerpt!.endsWith('…')).toBe(true);
});
