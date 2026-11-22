import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, isKnownCountry } from './countries.js';
import { NATIONALITY_PATTERN } from './personal-info.js';

describe('TF05C: mã quốc gia ISO 3166-1 alpha-2', () => {
  it('đủ 249 mã, không trùng, mã nào cũng khớp ràng buộc DB ck_users_nationality', () => {
    expect(COUNTRY_CODES.size).toBe(249);
    for (const code of COUNTRY_CODES) expect(NATIONALITY_PATTERN.test(code), code).toBe(true);
  });

  it('mã nào cũng có tên quốc gia thật trong dữ liệu Unicode CLDR của Node', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    for (const code of COUNTRY_CODES) {
      const name = names.of(code);
      expect(name, code).toBeDefined();
      expect(name, code).not.toBe(code);
    }
  });

  it('nhận VN, US, JP; từ chối mã dành riêng (XX, ZZ, AA, QO, XK), mã khu vực (EU, UN), chữ thường', () => {
    for (const code of ['VN', 'US', 'JP', 'KR', 'FR', 'SS', 'GB'])
      expect(isKnownCountry(code), code).toBe(true);
    for (const code of ['XX', 'ZZ', 'AA', 'QO', 'EU', 'UN', 'XK', 'vn', '', 'VNM'])
      expect(isKnownCountry(code), code).toBe(false);
  });
});
