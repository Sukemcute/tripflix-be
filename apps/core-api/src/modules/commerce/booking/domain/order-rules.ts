// Quy tắc thuần của đơn đặt chỗ: hạn giữ chỗ, thông tin khách, mã xác nhận, chính sách đặt chỗ.

export const HOLD_MINUTES = 30;
export const MAX_ITEMS_PER_ORDER = 10;
export const MAX_FAILED_PAYMENTS = 5;
export const HOLDS_PER_HOUR = 30;
export const POLICY_VERSION = '2026-11-03';

export type OrderStatus = 'pending' | 'paying' | 'paid' | 'cancelled' | 'expired';

export interface GuestInput {
  fullName: string;
  birthdate: string | null;
}

/** Loại hành khách vé bay; hành khách nhập theo thứ tự người lớn, trẻ em, em bé. */
export type PassengerType = 'adult' | 'child' | 'infant';

export const listPassengerTypes = (mix: { adults: number; children: number; infants: number }): PassengerType[] => [
  ...Array<PassengerType>(mix.adults).fill('adult'),
  ...Array<PassengerType>(mix.children).fill('child'),
  ...Array<PassengerType>(mix.infants).fill('infant'),
];

/** Tuổi tròn năm của người sinh ngày birthdate tính tới ngày date (YYYY-MM-DD). */
export function countAgeOn(birthdate: string, date: string): number {
  const age = Number(date.slice(0, 4)) - Number(birthdate.slice(0, 4));
  return date.slice(5) < birthdate.slice(5) ? age - 1 : age;
}

/**
 * Tuổi đúng loại khách cho cả chuyến, ageAtFirst và ageAtLast là tuổi ở chặng bay đầu và cuối:
 * người lớn từ 12 tuổi ở chặng đầu; em bé dưới 2 tuổi tới chặng cuối (không giữ ghế cho bé ở chặng nào);
 * trẻ em tối đa 11 tuổi ở chặng đầu và đủ 2 tuổi ở chặng cuối (bé lên 2 giữa chuyến phải có ghế).
 */
export function isAgeOfPassengerType(type: PassengerType, ageAtFirst: number, ageAtLast = ageAtFirst): boolean {
  if (type === 'adult') return ageAtFirst >= 12;
  if (type === 'child') return ageAtFirst <= 11 && ageAtLast >= 2;
  return ageAtFirst >= 0 && ageAtLast < 2;
}

/** Tuổi đúng loại khách ở phòng khách sạn tại ngày nhận phòng: em bé dưới 4 tuổi, trẻ em từ 4 đến dưới 12 tuổi. */
export function isAgeOfRoomGuest(type: PassengerType, age: number): boolean {
  if (type === 'adult') return age >= 12;
  if (type === 'child') return age >= 4 && age <= 11;
  return age >= 0 && age < 4;
}

export interface ContactInput {
  fullName: string;
  phone: string;
  email: string | null;
}

/** Một trường sai kèm câu báo cho người dùng biết sai ở đâu, sửa thế nào. */
export interface GuestFieldError {
  field: string;
  message: string;
}

const ROOM_AGE_MESSAGES: Record<PassengerType, string> = {
  adult: 'là người lớn, phải đủ 12 tuổi vào ngày nhận phòng',
  child: 'là trẻ em, phải từ 4 đến dưới 12 tuổi vào ngày nhận phòng',
  infant: 'là em bé, phải dưới 4 tuổi vào ngày nhận phòng',
};

const AGE_MESSAGES: Record<PassengerType, string> = {
  adult: 'là người lớn, phải đủ 12 tuổi vào ngày bay',
  child: 'là trẻ em, phải từ 2 đến 11 tuổi vào ngày bay',
  infant: 'là em bé, phải dưới 2 tuổi tới ngày bay chặng cuối',
};

/**
 * Các trường sai kèm câu báo cụ thể, để client hiện lỗi ngay ở ô nhập. Rỗng là hợp lệ.
 * Có passengerTypes và travelDates thì kiểm thêm tuổi theo chặng đúng loại khách của từng hành khách.
 */
export function listGuestFieldErrors(input: {
  contact: ContactInput;
  guests: GuestInput[];
  passengersRequired: number;
  today: string;
  passengerTypes?: PassengerType[];
  /** Ngày bay đầu và cuối của đơn (một chặng thì hai ngày như nhau). */
  travelDates?: { first: string; last: string };
  /** Ngày nhận phòng đầu tiên; chỉ dùng khi đơn không có vé bay. */
  stayDate?: string;
}): GuestFieldError[] {
  const errors: GuestFieldError[] = [];
  if (!input.contact.fullName.trim()) errors.push({ field: 'contact.fullName', message: 'Nhập họ tên người liên hệ.' });
  if (!/^0\d{9,10}$/.test(input.contact.phone.replace(/\s/g, ''))) errors.push({ field: 'contact.phone', message: 'Số điện thoại gồm 10–11 số, bắt đầu bằng 0.' });
  if (input.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contact.email)) errors.push({ field: 'contact.email', message: 'Email chưa đúng định dạng.' });
  if (input.passengersRequired > 0) {
    if (input.guests.length !== input.passengersRequired) errors.push({ field: 'guests', message: `Cần nhập đủ ${input.passengersRequired} hành khách.` });
    input.guests.forEach((g, i) => {
      const guest = `hành khách ${i + 1}`;
      if (!g.fullName.trim()) errors.push({ field: `guests[${i}].fullName`, message: `Nhập họ tên ${guest}.` });
      const field = `guests[${i}].birthdate`;
      const type = input.passengerTypes?.[i];
      const dates = input.travelDates;
      if (!g.birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(g.birthdate)) errors.push({ field, message: `Nhập ngày sinh ${guest} (YYYY-MM-DD).` });
      else if (g.birthdate > input.today) errors.push({ field, message: `Ngày sinh ${guest} không được sau hôm nay.` });
      else if (type && dates && !isAgeOfPassengerType(type, countAgeOn(g.birthdate, dates.first), countAgeOn(g.birthdate, dates.last)))
        errors.push({ field, message: `Hành khách ${i + 1} ${AGE_MESSAGES[type]}.` });
      else if (type && !dates && input.stayDate && !isAgeOfRoomGuest(type, countAgeOn(g.birthdate, input.stayDate)))
        errors.push({ field, message: `Hành khách ${i + 1} ${ROOM_AGE_MESSAGES[type]}.` });
    });
  }
  return errors;
}

/** Tên trường sai, để trả về client đánh dấu ô nhập. Rỗng là hợp lệ. */
export function findInvalidGuestFields(input: Parameters<typeof listGuestFieldErrors>[0]): string[] {
  return listGuestFieldErrors(input).map((e) => e.field);
}

/** Đã đủ thông tin để trả tiền: luôn cần người liên hệ; có vé bay thì cần đủ từng hành khách kèm ngày sinh. */
export function hasCompleteGuests(input: { contactName: string | null; contactPhone: string | null; guestBirthdates: (string | null)[]; passengersRequired: number }): boolean {
  if (!input.contactName || !input.contactPhone) return false;
  if (input.passengersRequired === 0) return true;
  return input.guestBirthdates.length === input.passengersRequired && input.guestBirthdates.every(Boolean);
}

/** Giữ chỗ còn hạn không, tính theo đồng hồ của server. */
export const isHoldExpired = (holdExpiresAt: Date, now: Date) => holdExpiresAt.getTime() <= now.getTime();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Mã xác nhận đọc được qua điện thoại: bỏ các ký tự dễ nhầm (0/O, 1/I). random là nguồn byte ngẫu nhiên. */
export function createConfirmationCode(randomBytes: Uint8Array): string {
  return `TF-${Array.from(randomBytes.slice(0, 6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')}`;
}

/** Khoá gửi sang cổng cho lần trả thứ attempt của đơn: cùng lần trả thì cùng khoá, cổng không trừ hai lần. */
export const buildChargeKey = (orderId: string, attempt: number) => `charge:${orderId}:${attempt}`;
export const buildCompensationRefundKey = (orderId: string) => `refund:comp:${orderId}`;
/** Theo từng khoản trừ: một đơn có thể có nhiều lần trả đã bỏ ngang, mỗi lần tiền về muộn là một khoản hoàn riêng. */
export const buildLateSuccessRefundKey = (paymentId: string) => `refund:late:${paymentId}`;
