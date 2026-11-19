/**
 * Các loại đơn bất thường (TF43). Chỉ phát hiện; sửa (hoàn tiền, chỉnh kho) do người vận hành làm sau khi xem đơn.
 * - double_charge: một đơn có từ hai khoản đã vào tiền mà chưa hoàn.
 * - charged_without_seat: đã trừ tiền nhưng đơn không thành paid (hết hạn, huỷ, kẹt): khách mất tiền, không có chỗ.
 * - paid_without_seat: đơn paid mà kho không ghi đủ chỗ bán, hoặc mục chưa có mã xác nhận.
 * - paid_amount_mismatch: đơn paid mà số đã trừ thành công khác tổng đơn (gồm không có khoản trừ nào).
 * - stuck_payment: khoản trừ chờ cổng quá 30 phút, hoặc đã chuyển người xử lý.
 * - refund_needs_review: khoản hoàn chờ người xử lý, hoặc chưa xong sau một ngày.
 */
export const ANOMALY_KINDS = ['double_charge', 'charged_without_seat', 'paid_without_seat', 'paid_amount_mismatch', 'stuck_payment', 'refund_needs_review'] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];
