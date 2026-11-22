import { createOutboxTable } from '@tripflix/outbox';
import { contentSchema } from './content-schema.js';

/**
 * Bảng outbox_events trong schema 'content'.
 * Lưu sự kiện phát sinh từ Media và Social trong cùng transaction DB với thay đổi.
 * Relay sẽ đọc và đẩy sang Redis Streams tương ứng (media -> stream:media, social -> stream:core.content).
 */
export const contentOutboxEvents = createOutboxTable(contentSchema);
export type ContentOutboxEventRow = typeof contentOutboxEvents.$inferSelect;
