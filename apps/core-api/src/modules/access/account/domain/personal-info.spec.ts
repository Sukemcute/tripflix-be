import { describe, expect, it } from 'vitest';
import { ageOn, isAllowedAge, normalizePhone, PHONE_PATTERN } from './personal-info.js';

describe('personal-info', () => {
  it('ageOn tính tuổi tròn năm, chưa tới sinh nhật thì trừ 1', () => {
    const today = new Date('2026-11-06T00:00:00Z');
    expect(ageOn('2000-11-06', today)).toBe(26);
    expect(ageOn('2000-11-07', today)).toBe(25);
    expect(ageOn('2000-12-01', today)).toBe(25);
  });

  it('isAllowedAge: 13–120 tuổi', () => {
    const today = new Date('2026-11-06T00:00:00Z');
    expect(isAllowedAge('2013-11-06', today)).toBe(true);
    expect(isAllowedAge('2013-11-07', today)).toBe(false);
    expect(isAllowedAge('1906-11-06', today)).toBe(true);
    expect(isAllowedAge('1905-11-05', today)).toBe(false);
  });

  it('normalizePhone bỏ dấu cách, chấm, gạch, ngoặc; PHONE_PATTERN nhận 8–15 chữ số, + ở đầu', () => {
    expect(normalizePhone('(+84) 912-345.678')).toBe('+84912345678');
    expect(PHONE_PATTERN.test('+84912345678')).toBe(true);
    expect(PHONE_PATTERN.test('1234567')).toBe(false);
    expect(PHONE_PATTERN.test('84+912345678')).toBe(false);
  });
});
