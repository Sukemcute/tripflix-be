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

  it('TF05C: đúng ngày sinh nhật thì đủ tuổi; đầu năm, cuối năm', () => {
    expect(ageOn('2000-01-01', new Date('2026-01-01T00:00:00Z'))).toBe(26);
    expect(ageOn('2000-12-31', new Date('2026-12-30T00:00:00Z'))).toBe(25);
    expect(ageOn('2000-12-31', new Date('2026-12-31T00:00:00Z'))).toBe(26);
  });

  it('TF05C: sinh ngày 29/02: năm không nhuận thì đủ tuổi từ 01/03, năm nhuận thì đúng 29/02', () => {
    expect(ageOn('2008-02-29', new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(ageOn('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
    expect(ageOn('2008-02-29', new Date('2028-02-28T00:00:00Z'))).toBe(19);
    expect(ageOn('2008-02-29', new Date('2028-02-29T00:00:00Z'))).toBe(20);
    // 13 tuổi: sinh 29/02/2012, năm 2025 không nhuận nên đủ 13 từ 01/03/2025.
    expect(isAllowedAge('2012-02-29', new Date('2025-02-28T00:00:00Z'))).toBe(false);
    expect(isAllowedAge('2012-02-29', new Date('2025-03-01T00:00:00Z'))).toBe(true);
  });

  it('TF05C: tính theo ngày UTC, giờ trong ngày không làm lệch tuổi', () => {
    expect(ageOn('2000-11-06', new Date('2026-11-06T23:59:59Z'))).toBe(26);
    expect(ageOn('2000-11-07', new Date('2026-11-06T23:59:59Z'))).toBe(25);
  });

  it('TF05C: 120 tuổi là lớn nhất, ngày sinh trong tương lai không hợp lệ', () => {
    const today = new Date('2026-11-06T00:00:00Z');
    expect(ageOn('1906-11-06', today)).toBe(120);
    expect(isAllowedAge('1906-11-07', today)).toBe(true); // 119 tuổi
    expect(isAllowedAge('1906-11-05', today)).toBe(true); // vẫn 120 tuổi
    expect(isAllowedAge('1905-11-06', today)).toBe(false); // 121 tuổi
    expect(isAllowedAge('2026-11-07', today)).toBe(false);
    expect(ageOn('2026-11-07', today)).toBe(-1);
  });

  it('normalizePhone bỏ dấu cách, chấm, gạch, ngoặc; PHONE_PATTERN nhận 8–15 chữ số, + ở đầu', () => {
    expect(normalizePhone('(+84) 912-345.678')).toBe('+84912345678');
    expect(PHONE_PATTERN.test('+84912345678')).toBe(true);
    expect(PHONE_PATTERN.test('1234567')).toBe(false);
    expect(PHONE_PATTERN.test('84+912345678')).toBe(false);
  });
});
