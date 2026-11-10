const VNPAY_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;

export function parseVnpayDate(value: string | undefined | null): Date | null {
  if (!value || !/^\d{14}$/.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;

  // Kiểm lại lịch để không nhận ngày bị JavaScript tự chuyển sang tháng sau.
  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, second, 0);
  if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 || localDate.getUTCDate() !== day) return null;

  return new Date(localDate.getTime() - VNPAY_OFFSET_MILLISECONDS);
}
