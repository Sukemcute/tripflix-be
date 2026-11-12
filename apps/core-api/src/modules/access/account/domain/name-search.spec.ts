import { describe, expect, it } from 'vitest';
import { VIETNAMESE_TRANSLATE_FROM, VIETNAMESE_TRANSLATE_TO, foldVietnamese } from './name-search.js';

describe('name-search', () => {
  it('foldVietnamese bỏ dấu và hạ chữ thường, kể cả Đ và chữ tổ hợp (NFD)', () => {
    expect(foldVietnamese('Bảo Đăng')).toBe('bao dang');
    expect(foldVietnamese('NGUYỄN Thị Ánh')).toBe('nguyen thi anh');
    expect(foldVietnamese('Bảo')).toBe('bao');
  });

  it('bảng translate dài bằng nhau và mỗi chữ khớp đúng bản không dấu', () => {
    const from = VIETNAMESE_TRANSLATE_FROM.split('');
    const to = VIETNAMESE_TRANSLATE_TO.split('');
    expect(to).toHaveLength(from.length);
    expect(to.every((c) => /^[a-z]$/.test(c))).toBe(true);
    expect(to[from.indexOf('Ữ')]).toBe('u');
  });
});
