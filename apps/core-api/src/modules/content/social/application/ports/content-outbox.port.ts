import type { NewOutboxEvent } from '@tripflix/outbox';

export const CONTENT_OUTBOX = Symbol('CONTENT_OUTBOX');

/**
 * Port ghi sự kiện vào content.outbox_events trong cùng transaction DB.
 * Sự kiện được bảo đảm tính nguyên tử (atomic) với thay đổi nghiệp vụ: nếu DB rollback thì sự kiện không đi.
 */
export interface ContentOutbox {
  add(event: NewOutboxEvent): Promise<string>;
}
