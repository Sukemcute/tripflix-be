import { randomUUID } from 'node:crypto';
import type {
  AccessStore,
  AuditEntry,
  NewSession,
  SessionRecord,
  SessionRotation,
  UserRecord,
} from '../../application/ports.js';

/** Bản lưu trong bộ nhớ của AccessStore, dùng cho E2E (CI không có Postgres). Không có rollback. */
export class MemoryAccessStore implements AccessStore {
  readonly userRows = new Map<string, UserRecord>();
  readonly sessionRows = new Map<string, SessionRecord & Omit<NewSession, 'userId' | 'refreshTokenHash' | 'expiresAt'>>();
  readonly auditRows: AuditEntry[] = [];

  readonly users = {
    findByEmail: async (email: string) => [...this.userRows.values()].find((u) => u.email === email) ?? null,
    findById: async (id: string) => this.userRows.get(id) ?? null,
    insert: async (user: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'>) => {
      if ([...this.userRows.values()].some((u) => u.email === user.email)) return null;
      const row: UserRecord = { ...user, id: randomUUID(), status: 'active', createdAt: new Date() };
      this.userRows.set(row.id, row);
      return row;
    },
    listStaff: async () => [...this.userRows.values()].filter((u) => u.role !== 'member'),
  };

  readonly sessions = {
    insert: async (session: NewSession) => {
      const row = { ...session, id: randomUUID(), previousTokenHash: null, rotatedAt: null };
      this.sessionRows.set(row.id, row);
      return row;
    },
    findByTokenHash: async (hash: string) =>
      [...this.sessionRows.values()].find((s) => s.refreshTokenHash === hash || s.previousTokenHash === hash) ?? null,
    rotate: async (id: string, expectedCurrentHash: string, next: SessionRotation) => {
      const row = this.sessionRows.get(id);
      if (!row || row.refreshTokenHash !== expectedCurrentHash) return false;
      this.sessionRows.set(id, { ...row, ...next });
      return true;
    },
    delete: async (id: string) => this.sessionRows.delete(id),
  };

  readonly audit = {
    record: async (entry: AuditEntry) => {
      this.auditRows.push(entry);
    },
  };

  transaction<T>(fn: (tx: Omit<AccessStore, 'transaction'>) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
