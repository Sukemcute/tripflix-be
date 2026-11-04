import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { buildEventEnvelope, type NewOutboxEvent } from '@tripflix/outbox';
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
    search: async ({ query, limit, offset }: { query?: string | undefined; limit: number; offset: number }) => {
      const q = query?.toLowerCase();
      const matched = [...this.userRows.values()]
        .filter((u) => !q || u.email.includes(q) || u.displayName.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { items: matched.slice(offset, offset + limit), total: matched.length };
    },
    updateRole: async (id: string, role: UserRecord['role']) => this.patchUser(id, { role }),
    updateStatus: async (id: string, status: UserRecord['status']) => this.patchUser(id, { status }),
  };

  private patchUser(id: string, patch: Partial<UserRecord>): UserRecord | null {
    const row = this.userRows.get(id);
    if (!row) return null;
    const next = { ...row, ...patch };
    this.userRows.set(id, next);
    return next;
  }

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
    deleteByUser: async (userId: string) => {
      const ids = [...this.sessionRows.values()].filter((s) => s.userId === userId).map((s) => s.id);
      for (const id of ids) this.sessionRows.delete(id);
      return ids;
    },
  };

  readonly audit = {
    record: async (entry: AuditEntry) => {
      this.auditRows.push(entry);
    },
  };

  readonly outboxRows: EventEnvelope[] = [];

  readonly outbox = {
    add: async (event: NewOutboxEvent) => {
      const envelope = buildEventEnvelope(event, 'core-api/access');
      this.outboxRows.push(envelope);
      return envelope.eventId;
    },
  };
}
