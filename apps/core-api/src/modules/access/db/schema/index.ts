import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mọi bảng của module access khai báo trong schema này. */
export const accessSchema = pgSchema('access');

const createdAtColumn = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// Tên constraint, index theo RULES §4.1: uq_, idx_, ck_, fk_<table>_<...>.

/** Tài khoản. email luôn lưu chữ thường; vai trò chỉ nhận 3 giá trị của docs/10 §3.10. */
export const users = accessSchema.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique('uq_users_email'),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_users_role', sql`${t.role} in ('member', 'moderator', 'superadmin')`),
    check('ck_users_status', sql`${t.status} in ('active', 'locked')`),
    check('ck_users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    // Liệt kê nhân viên nhanh mà không quét cả bảng người dùng.
    index('idx_users_role').on(t.role).where(sql`${t.role} <> 'member'`),
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
    userId: uuid('user_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique('uq_sessions_refresh_token_hash'),
    previousTokenHash: text('previous_token_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deviceName: text('device_name'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAtColumn(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'fk_sessions_user_id', columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    index('idx_sessions_previous_token_hash').on(t.previousTokenHash),
    index('idx_sessions_user_id').on(t.userId),
    index('idx_sessions_expires_at').on(t.expiresAt),
  ],
);

/** Nhật ký chỉ thêm, không sửa: đăng ký, đăng nhập, đăng xuất, phát hiện dùng lại token. */
export const auditLogs = accessSchema.table(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAtColumn(),
  },
  (t) => [index('idx_audit_logs_actor_user_id_created_at').on(t.actorUserId, t.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
