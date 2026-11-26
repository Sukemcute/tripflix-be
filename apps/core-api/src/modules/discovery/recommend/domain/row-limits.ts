import type { Kind } from './contracts.js';

/**
 * Trần số dòng thô theo người dùng, để một người (hoặc bot, stress test đã đăng nhập) không làm job tính đặc trưng
 * và feed đọc hàng chục nghìn dòng vào RAM.
 *
 * Loại chỉ-thêm có ref = eventId: mỗi lần tìm / chia sẻ là một dòng mới, không có trần tự nhiên. Loại khác có ref là
 * bài / đơn nên trần là số bài, nhưng người xem cả chục nghìn bài vẫn nặng.
 */
export const APPEND_ONLY_KINDS = ['share', 'search', 'stays_search', 'view', 'flight_search', 'booking_click'] as const satisfies readonly Kind[];

/** Dòng chỉ-thêm giữ trong bảng và đọc ra, mỗi người mỗi loại (mới nhất). live-answers chỉ xét 14 ngày, nửa đời 2 ngày. */
export const APPEND_ONLY_KEEP = 300;

/** Dòng đọc ra mỗi người mỗi loại còn lại (mới nhất). Không xoá: là trạng thái (đã like, đã gỡ…). */
export const OTHER_KIND_READ_CAP = 2_000;

/** Dòng chỉ-thêm được nạp mỗi người mỗi loại mỗi ngày (UTC); quá thì bỏ ở bước nạp. */
export const APPEND_ONLY_DAILY_CAP = 500;

const appendOnly = new Set<string>(APPEND_ONLY_KINDS);
export const isAppendOnly = (kind: string): boolean => appendOnly.has(kind);
