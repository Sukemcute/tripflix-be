import type { Role } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { OutboxWriter } from '@tripflix/outbox';
import { and, asc, count, desc, eq, gt, ilike, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  accessOutboxEvents,
  auditLogs,
  passwordResets,
  serviceClients,
  sessions,
  users,
  type ServiceClientRow,
  type SessionRow,
  type UserRow,
} from '../../db/schema/index.js';
import type {
  AccessOutbox,
  AccessStore,
  AuditEntry,
  AuditLog,
  NewSession,
  PasswordResetRepository,
  SessionRecord,
  SessionRepository,
  ServiceClientRecord,
  ServiceClientRepository,
  SessionRotation,
  UserRecord,
  UserRepository,
} from '../application/ports.js';

const mapUserRow = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  displayName: row.displayName,
  role: row.role as Role,
  status: row.status as UserRecord['status'],
  createdAt: row.createdAt,
});

const mapSessionRow = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.userId,
  refreshTokenHash: row.refreshTokenHash,
  previousTokenHash: row.previousTokenHash,
  rotatedAt: row.rotatedAt,
  expiresAt: row.expiresAt,
});

class DrizzleUserRepository implements UserRepository {
  constructor(private readonly getDb: () => Db) {}

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async findByEmail(email: string) {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? mapUserRow(row) : null;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? mapUserRow(row) : null;
  }

  async insert(user: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'>) {
    const [row] = await this.db.insert(users).values(user).onConflictDoNothing({ target: users.email }).returning();
    return row ? mapUserRow(row) : null;
  }

  async listStaff() {
    const rows = await this.db.select().from(users).where(ne(users.role, 'member')).orderBy(asc(users.createdAt));
    return rows.map(mapUserRow);
  }

  async search({ query, limit, offset }: { query?: string | undefined; limit: number; offset: number }) {
    // Thoát % _ \ trong từ khoá để ILIKE so đúng chữ người dùng gõ.
    const pattern = query ? `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
    const where = pattern ? or(ilike(users.email, pattern), ilike(users.displayName, pattern)) : undefined;
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    return { items: rows.map(mapUserRow), total: counted?.total ?? 0 };
  }

  async updateRole(id: string, role: UserRecord['role']) {
    const [row] = await this.db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return row ? mapUserRow(row) : null;
  }

  async updateStatus(id: string, status: UserRecord['status']) {
    return this.patch(id, { status });
  }

  async updateDisplayName(id: string, displayName: string) {
    return this.patch(id, { displayName });
  }

  async updatePasswordHash(id: string, passwordHash: string) {
    return this.patch(id, { passwordHash });
  }

  private async patch(id: string, values: Partial<Pick<UserRow, 'status' | 'displayName' | 'passwordHash'>>) {
    const [row] = await this.db.update(users).set({ ...values, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return row ? mapUserRow(row) : null;
  }
}

class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly getDb: () => Db) {}

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async insert(session: NewSession) {
    const [row] = await this.db.insert(sessions).values(session).returning();
    if (!row) throw new Error('Không tạo được phiên đăng nhập');
    return mapSessionRow(row);
  }

  async findByTokenHash(hash: string) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(or(eq(sessions.refreshTokenHash, hash), eq(sessions.previousTokenHash, hash)))
      .limit(1);
    return row ? mapSessionRow(row) : null;
  }

  async rotate(id: string, expectedCurrentHash: string, next: SessionRotation) {
    const rows = await this.db
      .update(sessions)
      .set(next)
      .where(and(eq(sessions.id, id), eq(sessions.refreshTokenHash, expectedCurrentHash)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async delete(id: string) {
    const rows = await this.db.delete(sessions).where(eq(sessions.id, id)).returning({ id: sessions.id });
    return rows.length > 0;
  }

  async deleteByUser(userId: string, exceptId?: string) {
    const where = exceptId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptId)) : eq(sessions.userId, userId);
    const rows = await this.db.delete(sessions).where(where).returning({ id: sessions.id });
    return rows.map((r) => r.id);
  }

  async deleteOwned(id: string, userId: string) {
    const rows = await this.db
      .delete(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async listActiveByUser(userId: string, now: Date) {
    return this.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
      .orderBy(desc(sessions.lastUsedAt));
  }

  async deleteExpired(before: Date) {
    // Có idx_sessions_expires_at nên không quét cả bảng.
    const rows = await this.db.delete(sessions).where(lt(sessions.expiresAt, before)).returning({ id: sessions.id });
    return rows.length;
  }
}

const mapServiceClientRow = (row: ServiceClientRow): ServiceClientRecord => ({ ...row });

class DrizzleServiceClientRepository implements ServiceClientRepository {
  constructor(private readonly getDb: () => Db) {}

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async findById(clientId: string) {
    const [row] = await this.db.select().from(serviceClients).where(eq(serviceClients.clientId, clientId)).limit(1);
    return row ? mapServiceClientRow(row) : null;
  }

  async insert(client: Pick<ServiceClientRecord, 'clientId' | 'secretHash' | 'allowedAudiences'>) {
    const [row] = await this.db.insert(serviceClients).values(client).onConflictDoNothing().returning();
    return row ? mapServiceClientRow(row) : null;
  }

  async disable(clientId: string, at: Date) {
    const rows = await this.db
      .update(serviceClients)
      .set({ disabledAt: sql`coalesce(${serviceClients.disabledAt}, ${at})` })
      .where(eq(serviceClients.clientId, clientId))
      .returning({ clientId: serviceClients.clientId });
    return rows.length > 0;
  }
}

class DrizzlePasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly getDb: () => Db) {}

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async insert(reset: { userId: string; tokenHash: string; expiresAt: Date }) {
    await this.db.insert(passwordResets).values(reset);
  }

  async deleteUnusedByUser(userId: string) {
    const rows = await this.db
      .delete(passwordResets)
      .where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)))
      .returning({ id: passwordResets.id });
    return rows.length;
  }

  async findUsable(tokenHash: string, now: Date) {
    const [row] = await this.db
      .select({ userId: passwordResets.userId })
      .from(passwordResets)
      .where(this.usable(tokenHash, now))
      .limit(1);
    return row ?? null;
  }

  async consume(tokenHash: string, now: Date) {
    const [row] = await this.db
      .update(passwordResets)
      .set({ usedAt: now })
      .where(this.usable(tokenHash, now))
      .returning({ userId: passwordResets.userId });
    return row ?? null;
  }

  async deleteExpired(before: Date) {
    const rows = await this.db.delete(passwordResets).where(lt(passwordResets.expiresAt, before)).returning({ id: passwordResets.id });
    return rows.length;
  }

  private usable(tokenHash: string, now: Date) {
    return and(eq(passwordResets.tokenHash, tokenHash), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now));
  }
}

class DrizzleAuditLog implements AuditLog {
  constructor(private readonly getDb: () => Db) {}

  // Mỗi lệnh lấy executor mới: trong @Transactional là transaction đang mở, ngoài ra là kết nối thường.
  private get db(): Db {
    return this.getDb();
  }

  async record({ action, actorUserId, ip, userAgent, meta }: AuditEntry) {
    await this.db.insert(auditLogs).values({
      action,
      actorUserId: actorUserId ?? null,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      meta: meta ?? {},
    });
  }
}

/** Tên nguồn phát ghi vào phong bì sự kiện của access. */
export const ACCESS_EVENT_PRODUCER = 'core-api/access';

/**
 * Repository của access trên user Postgres tf_access, chỉ có quyền trên schema access.
 * `getDb` trả executor cho từng lệnh: trong Nest là `() => txHost.tx` (transaction của @Transactional('access')
 * nếu đang mở); ở CLI, test là `() => db`.
 */
export class DrizzleAccessStore implements AccessStore {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditLog;
  readonly outbox: AccessOutbox;
  readonly serviceClients: ServiceClientRepository;
  readonly passwordResets: PasswordResetRepository;

  constructor(getDb: () => Db) {
    this.users = new DrizzleUserRepository(getDb);
    this.sessions = new DrizzleSessionRepository(getDb);
    this.audit = new DrizzleAuditLog(getDb);
    this.outbox = new OutboxWriter(getDb, accessOutboxEvents, ACCESS_EVENT_PRODUCER);
    this.serviceClients = new DrizzleServiceClientRepository(getDb);
    this.passwordResets = new DrizzlePasswordResetRepository(getDb);
  }
}
