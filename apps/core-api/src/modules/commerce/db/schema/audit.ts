import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { commerceSchema } from './commerce-schema.js';

/**
 * Nhật ký thao tác của nhân viên trên dữ liệu tiền và chỗ (sửa giá, số phòng, luật bán).
 * Ghi cùng transaction với thay đổi: sửa rollback thì nhật ký cũng không còn. actor_user_id trỏ sang
 * access.users nhưng không đặt khoá ngoại vì khác database.
 */
export const auditLogs = commerceSchema.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    // Khoảng ngày và các trường đã đổi (giá trị mới); đủ để biết ai đổi gì, lúc nào.
    changes: jsonb('changes').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_logs_entity').on(t.entityType, t.entityId, t.createdAt),
    check('ck_audit_logs_entity_type', sql`${t.entityType} in ('room_type', 'flight')`),
  ],
);
