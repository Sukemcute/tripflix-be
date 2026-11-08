import { describe, expect, it } from 'vitest';
import { countAgeOn, findInvalidGuestFields, isAgeOfPassengerType, listGuestFieldErrors, listPassengerTypes } from './order-rules.js';

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

  it('sinh ngày 29/02: năm không nhuận thì tròn tuổi từ ngày 01/03', () => {
    expect(countAgeOn('2024-02-29', '2026-02-28')).toBe(1);
    expect(countAgeOn('2024-02-29', '2026-03-01')).toBe(2);
    expect(countAgeOn('2024-02-29', '2028-02-29')).toBe(4);
  });

  it('người lớn từ 12 tuổi, trẻ em 2–11, em bé dưới 2', () => {
    expect(isAgeOfPassengerType('adult', 12)).toBe(true);
    expect(isAgeOfPassengerType('adult', 11)).toBe(false);
    expect(isAgeOfPassengerType('child', 2)).toBe(true);
    expect(isAgeOfPassengerType('child', 12)).toBe(false);
    expect(isAgeOfPassengerType('infant', 1)).toBe(true);
    expect(isAgeOfPassengerType('infant', 2)).toBe(false);
  });

  it('lên 2 tuổi giữa chuyến khứ hồi: không còn là em bé, phải đi vé trẻ em có ghế', () => {
    expect(isAgeOfPassengerType('infant', 1, 2)).toBe(false);
    expect(isAgeOfPassengerType('child', 1, 2)).toBe(true);
    // Lên 12 tuổi lúc về vẫn đi vé trẻ em: ghế đã giữ, giá chốt theo chặng đầu.
    expect(isAgeOfPassengerType('child', 11, 12)).toBe(true);
    expect(isAgeOfPassengerType('adult', 11, 12)).toBe(false);
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
        travelDates: { first: TRAVEL, last: TRAVEL },
      });
    // Con lớn chưa đủ 2 tuổi vào ngày bay nên không phải trẻ em.
    expect(check(['1990-05-01', '2024-12-21', '2025-06-01'])).toEqual(['guests[1].birthdate']);
    expect(check(['1990-05-01', '2020-01-01', '2025-06-01'])).toEqual([]);
  });

  it('khứ hồi: em bé phải dưới 2 tuổi tới chặng về', () => {
    const guests = [
      { fullName: 'Mẹ', birthdate: '1992-05-01' },
      { fullName: 'Bé', birthdate: '2024-12-25' },
    ];
    const check = (last: string) =>
      findInvalidGuestFields({ contact, guests, passengersRequired: 2, today: TODAY, passengerTypes: ['adult', 'infant'], travelDates: { first: TRAVEL, last } });
    expect(check('2026-12-24')).toEqual([]);
    // Ngày 25/12/2026 bé tròn 2 tuổi: chặng về cần ghế.
    expect(check('2026-12-26')).toEqual(['guests[1].birthdate']);
  });

  it('không có loại khách thì giữ cách kiểm cũ: chỉ cần ngày sinh hợp lệ', () => {
    expect(findInvalidGuestFields({ contact, guests: [{ fullName: 'Bé', birthdate: '2025-06-01' }], passengersRequired: 1, today: TODAY })).toEqual([]);
  });
});

describe('câu báo lỗi theo từng trường', () => {
  it('người lớn sinh hôm nay: báo đúng ô ngày sinh, nói rõ phải đủ 12 tuổi', () => {
    expect(
      listGuestFieldErrors({
        contact,
        guests: [{ fullName: 'Lê Hoàng Tuấn', birthdate: TODAY }],
        passengersRequired: 1,
        today: TODAY,
        passengerTypes: ['adult'],
        travelDates: { first: TRAVEL, last: TRAVEL },
      }),
    ).toEqual([{ field: 'guests[0].birthdate', message: 'Hành khách 1 là người lớn, phải đủ 12 tuổi vào ngày bay.' }]);
  });

  it('trả đủ mọi trường sai, mỗi trường một câu riêng', () => {
    const errors = listGuestFieldErrors({
      contact: { fullName: ' ', phone: '12345', email: 'sai' },
      guests: [
        { fullName: '', birthdate: null },
        { fullName: 'Bé', birthdate: '2027-01-01' },
      ],
      passengersRequired: 2,
      today: TODAY,
    });
    expect(errors).toEqual([
      { field: 'contact.fullName', message: 'Nhập họ tên người liên hệ.' },
      { field: 'contact.phone', message: 'Số điện thoại gồm 10–11 số, bắt đầu bằng 0.' },
      { field: 'contact.email', message: 'Email chưa đúng định dạng.' },
      { field: 'guests[0].fullName', message: 'Nhập họ tên hành khách 1.' },
      { field: 'guests[0].birthdate', message: 'Nhập ngày sinh hành khách 1 (YYYY-MM-DD).' },
      { field: 'guests[1].birthdate', message: 'Ngày sinh hành khách 2 không được sau hôm nay.' },
    ]);
  });

  it('thiếu hành khách thì báo cần nhập đủ số khách', () => {
    expect(listGuestFieldErrors({ contact, guests: [], passengersRequired: 2, today: TODAY })).toEqual([
      { field: 'guests', message: 'Cần nhập đủ 2 hành khách.' },
    ]);
  });
});
