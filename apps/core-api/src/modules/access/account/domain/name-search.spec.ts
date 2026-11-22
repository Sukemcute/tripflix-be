import { describe, expect, it } from 'vitest';
import {
  VIETNAMESE_TRANSLATE_FROM,
  VIETNAMESE_TRANSLATE_TO,
  buildIpRateKey,
  foldVietnamese,
  hasInvisibleCharacters,
  normalizeSearchQuery,
} from './name-search.js';

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

  it('chuẩn hóa NFKC và khoảng trắng, giữ ký tự vô hình để bước validate từ chối', () => {
    expect(normalizeSearchQuery('  Ｂảo   Lê  ')).toBe('Bảo Lê');
    expect(normalizeSearchQuery('Bảo')).toBe('Bảo');
    expect(hasInvisibleCharacters(normalizeSearchQuery('Ｂảo\u200b Lê\u0000'))).toBe(true);
    expect(hasInvisibleCharacters(normalizeSearchQuery('Bảo Lê'))).toBe(false);
  });

  it('buildIpRateKey: IPv4 giữ nguyên, IPv4-mapped về IPv4, IPv6 gộp theo /64', () => {
    expect(buildIpRateKey('203.0.113.9')).toBe('203.0.113.9');
    expect(buildIpRateKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(buildIpRateKey('2001:db8:1:2::7')).toBe('2001:db8:1:2::/64');
    expect(buildIpRateKey('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(buildIpRateKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(buildIpRateKey('::1')).toBe('0:0:0:0::/64');
  });
});
