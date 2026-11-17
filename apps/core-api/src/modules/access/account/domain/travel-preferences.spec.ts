import { isStaleTravelPreferences, type TravelPreferences } from './travel-preferences.js';

const at = (updatedAt: string): TravelPreferences => ({ status: 'completed', interests: ['coast'], regions: [], budgetLevels: [], updatedAt });

describe('isStaleTravelPreferences', () => {
  it('bản gửi lên cũ hơn bản đang lưu thì bỏ, so theo thời điểm chứ không theo chuỗi', () => {
    expect(isStaleTravelPreferences(at('2026-11-16T10:00:00.000Z'), at('2026-11-17T10:00:00.000Z'))).toBe(true);
    // 08:00+07:00 = 01:00Z, mới hơn 00:30Z dù chuỗi so ra nhỏ hơn.
    expect(isStaleTravelPreferences(at('2026-11-17T08:00:00+07:00'), at('2026-11-17T00:30:00.000Z'))).toBe(false);
  });

  it('cùng mốc, chưa có bản lưu, hoặc đặt lại (null) thì không coi là cũ', () => {
    expect(isStaleTravelPreferences(at('2026-11-17T10:00:00.000Z'), at('2026-11-17T10:00:00.000Z'))).toBe(false);
    expect(isStaleTravelPreferences(at('2026-11-17T10:00:00.000Z'), null)).toBe(false);
    expect(isStaleTravelPreferences(null, at('2026-11-17T10:00:00.000Z'))).toBe(false);
  });
});
