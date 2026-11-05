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

export interface ContactInput {
  fullName: string;
  phone: string;
  email: string | null;
}

/** Tên trường sai, để trả về client đánh dấu ô nhập. Rỗng là hợp lệ. */
export function findInvalidGuestFields(input: { contact: ContactInput; guests: GuestInput[]; passengersRequired: number; today: string }): string[] {
  const invalid: string[] = [];
  if (!input.contact.fullName.trim()) invalid.push('contact.fullName');
  if (!/^0\d{9,10}$/.test(input.contact.phone.replace(/\s/g, ''))) invalid.push('contact.phone');
  if (input.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contact.email)) invalid.push('contact.email');
  if (input.passengersRequired > 0) {
    if (input.guests.length !== input.passengersRequired) invalid.push('guests');
    input.guests.forEach((g, i) => {
      if (!g.fullName.trim()) invalid.push(`guests[${i}].fullName`);
      if (!g.birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(g.birthdate) || g.birthdate > input.today) invalid.push(`guests[${i}].birthdate`);
    });
  }
  return invalid;
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
