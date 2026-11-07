import { describe, expect, it } from 'vitest';
import { countAgeOn, findInvalidGuestFields, isAgeOfPassengerType, listPassengerTypes } from './order-rules.js';

const contact = { fullName: 'Người Đặt', phone: '0901234567', email: null };
const TODAY = '2026-12-01';
const TRAVEL = '2026-12-20';

describe('hành khách theo loại', () => {
  it('xếp người lớn, rồi trẻ em, rồi em bé', () => {
    expect(listPassengerTypes({ adults: 2, children: 1, infants: 1 })).toEqual(['adult', 'adult', 'child', 'infant']);
  });

  it('tuổi tròn năm tính tới ngày bay, chưa tới sinh nhật thì chưa tăng tuổi', () => {
    expect(countAgeOn('2024-12-20', TRAVEL)).toBe(2);
    expect(countAgeOn('2024-12-21', TRAVEL)).toBe(1);
    expect(countAgeOn('2014-12-20', TRAVEL)).toBe(12);
  });

  it('người lớn từ 12 tuổi, trẻ em 2–11, em bé dưới 2', () => {
    expect(isAgeOfPassengerType('adult', 12)).toBe(true);
    expect(isAgeOfPassengerType('adult', 11)).toBe(false);
    expect(isAgeOfPassengerType('child', 2)).toBe(true);
    expect(isAgeOfPassengerType('child', 12)).toBe(false);
    expect(isAgeOfPassengerType('infant', 1)).toBe(true);
    expect(isAgeOfPassengerType('infant', 2)).toBe(false);
  });

  it('ngày sinh không đúng loại khách tại ngày bay thì báo đúng ô', () => {
    const guests = [
      { fullName: 'Bố', birthdate: '1990-05-01' },
      { fullName: 'Con lớn', birthdate: '2024-12-21' },
      { fullName: 'Con nhỏ', birthdate: '2025-06-01' },
    ];
    const check = (birthdates: string[]) =>
      findInvalidGuestFields({
        contact,
        guests: guests.map((g, i) => ({ ...g, birthdate: birthdates[i]! })),
        passengersRequired: 3,
        today: TODAY,
        passengerTypes: ['adult', 'child', 'infant'],
        travelDate: TRAVEL,
      });
    // Con lớn chưa đủ 2 tuổi vào ngày bay nên không phải trẻ em.
    expect(check(['1990-05-01', '2024-12-21', '2025-06-01'])).toEqual(['guests[1].birthdate']);
    expect(check(['1990-05-01', '2020-01-01', '2025-06-01'])).toEqual([]);
  });

  it('không có loại khách thì giữ cách kiểm cũ: chỉ cần ngày sinh hợp lệ', () => {
    expect(findInvalidGuestFields({ contact, guests: [{ fullName: 'Bé', birthdate: '2025-06-01' }], passengersRequired: 1, today: TODAY })).toEqual([]);
  });
});
