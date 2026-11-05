import { createOutboxTable } from '@tripflix/outbox';
import { contentSchema } from './content-schema.js';

/** Outbox chung của module content (content.outbox_events). Stream đích chọn theo loại sự kiện ở relay. */
export const contentOutboxEvents = createOutboxTable(contentSchema);
