import type { Role } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { and, asc, eq, ne, or } from 'drizzle-orm';
import { auditLog, sessions, users, type SessionRow, type UserRow } from '../../db/schema/index.js';
import type {
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

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.passwordHash,
  displayName: row.displayName,
  role: row.role as Role,
  status: row.status as UserRecord['status'],
  createdAt: row.createdAt,
});

const toSession = (row: SessionRow): SessionRecord => ({
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
    return row ? toUser(row) : null;
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }

  async insert(user: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'>) {
    const [row] = await this.db.insert(users).values(user).onConflictDoNothing({ target: users.email }).returning();
    return row ? toUser(row) : null;
  }

  async listStaff() {
    const rows = await this.db.select().from(users).where(ne(users.role, 'member')).orderBy(asc(users.createdAt));
    return rows.map(toUser);
  }
}

class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async insert(session: NewSession) {
    const [row] = await this.db.insert(sessions).values(session).returning();
    if (!row) throw new Error('Không tạo được phiên đăng nhập');
    return toSession(row);
  }

  async findByTokenHash(hash: string) {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(or(eq(sessions.refreshTokenHash, hash), eq(sessions.previousTokenHash, hash)))
      .limit(1);
    return row ? toSession(row) : null;
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
    await this.db.insert(auditLog).values({
      action,
      actorUserId: actorUserId ?? null,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      meta: meta ?? {},
    });
  }
}

function repositories(db: Db) {
  return {
    users: new DrizzleUserRepository(db),
    sessions: new DrizzleSessionRepository(db),
    audit: new DrizzleAuditLog(db),
  };
}

/** Kết nối bằng user Postgres tf_access, chỉ có quyền trên schema access. */
export class DrizzleAccessStore implements AccessStore {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditLog;

  constructor(private readonly db: Db) {
    Object.assign(this, repositories(db));
  }

  transaction<T>(fn: (tx: Omit<AccessStore, 'transaction'>) => Promise<T>): Promise<T> {
    // PgTransaction có cùng các hàm select/insert/update/delete như Db.
    return this.db.transaction((tx) => fn(repositories(tx as unknown as Db)));
  }
}
