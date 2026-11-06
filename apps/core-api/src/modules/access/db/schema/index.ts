import { createOutboxTable } from '@tripflix/outbox';
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, jsonb, pgSchema, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    // Trống với tài khoản chỉ đăng nhập bằng Google (TF059); đăng nhập bằng mật khẩu vào tài khoản này luôn lỗi chung.
    passwordHash: text('password_hash'),
    displayName: text('display_name').notNull(),
    // Thông tin cá nhân (TF06M): chỉ chủ tài khoản xem/sửa qua /auth/me, không đưa lên event bus. Đều có thể trống.
    phone: text('phone'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    gender: text('gender'),
    nationality: text('nationality'),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    // Thời điểm chủ tài khoản chứng minh sở hữu email (TF05D): bấm link xác thực, đặt lại mật khẩu qua email,
    // hoặc đăng nhập Google. Trống: chưa xác thực, chưa được đăng bài, bình luận.
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ck_users_role', sql`${t.role} in ('member', 'moderator', 'superadmin')`),
    check('ck_users_status', sql`${t.status} in ('active', 'locked')`),
    check('ck_users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('ck_users_gender', sql`${t.gender} is null or ${t.gender} in ('male', 'female', 'other')`),
    check('ck_users_nationality', sql`${t.nationality} is null or ${t.nationality} ~ '^[A-Z]{2}$'`),
    check('ck_users_phone', sql`${t.phone} is null or ${t.phone} ~ '^[+]?[0-9]{8,15}$'`),
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

/** Tài khoản đăng nhập ngoài (Google). (provider, subject) là mã của người dùng bên đó, không đổi khi đổi email. */
export const userIdentities = accessSchema.table(
  'user_identities',
  {
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: 'pk_user_identities', columns: [t.provider, t.subject] }),
    foreignKey({ name: 'fk_user_identities_user_id', columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    index('idx_user_identities_user_id').on(t.userId),
    check('ck_user_identities_provider', sql`${t.provider} in ('google')`),
  ],
);

/**
 * Token đặt lại mật khẩu (quên mật khẩu). Chỉ lưu SHA-256 của token; dùng một lần (used_at), sống 30 phút.
 * Yêu cầu mới thì xoá token chưa dùng của người đó, nên mỗi lúc chỉ có một link còn hiệu lực.
 */
export const passwordResets = accessSchema.table(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique('uq_password_resets_token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    foreignKey({ name: 'fk_password_resets_user_id', columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    index('idx_password_resets_user_id').on(t.userId),
    index('idx_password_resets_expires_at').on(t.expiresAt),
  ],
);

/**
 * Link xác thực email (TF05D), cùng cách với password_resets: chỉ giữ SHA-256 của token, dùng một lần,
 * sống 24 giờ. Mỗi lúc một người chỉ có một link chưa dùng (gửi lại thì xoá link cũ).
 */
export const registrationChallenges = accessSchema.table(
  'registration_challenges',
  {
    email: text('email').primaryKey(),
    id: uuid('id').notNull().unique('uq_registration_challenges_id'),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_registration_challenges_expires_at').on(table.expiresAt)],
);

export const emailVerifications = accessSchema.table(
  'email_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique('uq_email_verifications_token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    foreignKey({ name: 'fk_email_verifications_user_id', columns: [t.userId], foreignColumns: [users.id] }).onDelete('cascade'),
    index('idx_email_verifications_user_id').on(t.userId),
    index('idx_email_verifications_expires_at').on(t.expiresAt),
  ],
);

/**
 * Service được xin token service-to-service (docs/10 §3.10). Chỉ lưu bản băm argon2 của secret.
 * allowed_audiences: các service mà client này được gọi (aud của token). disabled_at khác null: không cấp token nữa.
 */
export const serviceClients = accessSchema.table(
  'service_clients',
  {
    clientId: text('client_id').primaryKey(),
    secretHash: text('secret_hash').notNull(),
    allowedAudiences: text('allowed_audiences').array().notNull(),
    createdAt: createdAtColumn(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_service_clients_client_id_format', sql`${t.clientId} ~ '^[a-z][a-z0-9-]{1,49}$'`),
    check('ck_service_clients_allowed_audiences_not_empty', sql`cardinality(${t.allowedAudiences}) > 0`),
  ],
);

/** Sự kiện của access chờ relay gửi sang stream:core.access (libs/outbox). */
export const accessOutboxEvents = createOutboxTable(accessSchema);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ServiceClientRow = typeof serviceClients.$inferSelect;
