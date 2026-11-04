import type { Role } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { addOutboxEvent, type NewOutboxEvent } from '@tripflix/outbox';
import { and, asc, eq, ne, or } from 'drizzle-orm';
import { accessOutboxEvents, auditLogs, sessions, users, type SessionRow, type UserRow } from '../../db/schema/index.js';
import type {
  AccessOutbox,
  AccessStore,
  AuditEntry,
  AuditLog,
  NewSession,
  SessionRecord,
  SessionRepository,
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
  constructor(private readonly db: Db) {}

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
}

class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

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
}

class DrizzleAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}

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

function createRepositories(db: Db) {
  return {
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionRepository(db),
    audit: new DrizzleAuditLog(db),
    outbox: {
      add: (event: NewOutboxEvent) => addOutboxEvent(db, accessOutboxEvents, event, ACCESS_EVENT_PRODUCER),
    } satisfies AccessOutbox,
  };
}

/** Kết nối bằng user Postgres tf_access, chỉ có quyền trên schema access. */
export class DrizzleAccessStore implements AccessStore {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditLog;
  readonly outbox: AccessOutbox;

  constructor(private readonly db: Db) {
    Object.assign(this, createRepositories(db));
  }

  transaction<T>(fn: (tx: Omit<AccessStore, 'transaction'>) => Promise<T>): Promise<T> {
    // PgTransaction có cùng các hàm select/insert/update/delete như Db.
    return this.db.transaction((tx) => fn(createRepositories(tx as unknown as Db)));
  }
}
