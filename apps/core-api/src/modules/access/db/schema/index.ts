import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mọi bảng của module access khai báo trong schema này. */
export const accessSchema = pgSchema('access');

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Tài khoản. email luôn lưu chữ thường; vai trò chỉ nhận 3 giá trị của docs/10 §3.10. */
export const users = accessSchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique('users_email_key'),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} in ('member', 'moderator', 'superadmin')`),
    check('users_status_check', sql`${t.status} in ('active', 'locked')`),
    check('users_email_lower_check', sql`${t.email} = lower(${t.email})`),
    // Liệt kê nhân viên nhanh mà không quét cả bảng người dùng.
    index('users_staff_idx').on(t.role).where(sql`${t.role} <> 'member'`),
  ],
);

/**
 * Mỗi lần đăng nhập trên một thiết bị là một phiên. id chính là claim sid trong access token.
 * Chỉ lưu bản băm SHA-256 của refresh token; previous_token_hash để phát hiện dùng lại token cũ.
 */
export const sessions = accessSchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique('sessions_refresh_token_hash_key'),
    previousTokenHash: text('previous_token_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deviceName: text('device_name'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_previous_token_hash_idx').on(t.previousTokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/** Nhật ký chỉ thêm, không sửa: đăng ký, đăng nhập, đăng xuất, phát hiện dùng lại token. */
export const auditLog = accessSchema.table(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_actor_created_idx').on(t.actorUserId, t.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
