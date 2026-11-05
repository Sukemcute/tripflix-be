import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { buildEventEnvelope, type NewOutboxEvent } from '@tripflix/outbox';
import type {
  AccessStore,
  AuditEntry,
  NewSession,
  SessionRecord,
  ServiceClientRecord,
  SessionRotation,
  SessionSummary,
  UserRecord,
} from '../../application/ports.js';

/** Bản lưu trong bộ nhớ của AccessStore, dùng cho E2E (CI không có Postgres). Không có rollback. */
export class MemoryAccessStore implements AccessStore {
  readonly userRows = new Map<string, UserRecord>();
  readonly sessionRows = new Map<
    string,
    SessionRecord & Omit<NewSession, 'userId' | 'refreshTokenHash' | 'expiresAt'> & { createdAt: Date; lastUsedAt: Date }
  >();
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
    updateDisplayName: async (id: string, displayName: string) => this.patchUser(id, { displayName }),
    updatePasswordHash: async (id: string, passwordHash: string) => this.patchUser(id, { passwordHash }),
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
      const now = new Date();
      const row = { ...session, id: randomUUID(), previousTokenHash: null, rotatedAt: null, createdAt: now, lastUsedAt: now };
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
    deleteByUser: async (userId: string, exceptId?: string) => {
      const ids = [...this.sessionRows.values()].filter((s) => s.userId === userId && s.id !== exceptId).map((s) => s.id);
      for (const id of ids) this.sessionRows.delete(id);
      return ids;
    },
    deleteOwned: async (id: string, userId: string) =>
      this.sessionRows.get(id)?.userId === userId ? this.sessionRows.delete(id) : false,
    listActiveByUser: async (userId: string, now: Date): Promise<SessionSummary[]> =>
      [...this.sessionRows.values()]
        .filter((s) => s.userId === userId && s.expiresAt > now)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map(({ id, deviceName, userAgent, createdAt, lastUsedAt }) => ({ id, deviceName, userAgent, createdAt, lastUsedAt })),
    deleteExpired: async (before: Date) => {
      const ids = [...this.sessionRows.values()].filter((s) => s.expiresAt < before).map((s) => s.id);
      for (const id of ids) this.sessionRows.delete(id);
      return ids.length;
    },
  };

  readonly audit = {
    record: async (entry: AuditEntry) => {
      this.auditRows.push(entry);
    },
  };

  readonly serviceClientRows = new Map<string, ServiceClientRecord>();

  readonly serviceClients = {
    findById: async (clientId: string) => this.serviceClientRows.get(clientId) ?? null,
    insert: async (client: Pick<ServiceClientRecord, 'clientId' | 'secretHash' | 'allowedAudiences'>) => {
      if (this.serviceClientRows.has(client.clientId)) return null;
      const row: ServiceClientRecord = { ...client, createdAt: new Date(), disabledAt: null };
      this.serviceClientRows.set(row.clientId, row);
      return row;
    },
    disable: async (clientId: string, at: Date) => {
      const row = this.serviceClientRows.get(clientId);
      if (!row) return false;
      this.serviceClientRows.set(clientId, { ...row, disabledAt: row.disabledAt ?? at });
      return true;
    },
  };

  readonly passwordResetRows: { userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }[] = [];

  readonly passwordResets = {
    insert: async (reset: { userId: string; tokenHash: string; expiresAt: Date }) => {
      this.passwordResetRows.push({ ...reset, usedAt: null });
    },
    deleteUnusedByUser: async (userId: string) => this.removeResets((r) => r.userId === userId && !r.usedAt),
    findUsable: async (tokenHash: string, now: Date) => {
      const row = this.passwordResetRows.find((r) => r.tokenHash === tokenHash && !r.usedAt && r.expiresAt > now);
      return row ? { userId: row.userId } : null;
    },
    consume: async (tokenHash: string, now: Date) => {
      const row = this.passwordResetRows.find((r) => r.tokenHash === tokenHash && !r.usedAt && r.expiresAt > now);
      if (!row) return null;
      row.usedAt = now;
      return { userId: row.userId };
    },
    deleteExpired: async (before: Date) => this.removeResets((r) => r.expiresAt < before),
  };

  private removeResets(match: (r: { userId: string; usedAt: Date | null; expiresAt: Date }) => boolean): number {
    const kept = this.passwordResetRows.filter((r) => !match(r));
    const removed = this.passwordResetRows.length - kept.length;
    this.passwordResetRows.splice(0, this.passwordResetRows.length, ...kept);
    return removed;
  }

  readonly outboxRows: EventEnvelope[] = [];

  readonly outbox = {
    add: async (event: NewOutboxEvent) => {
      const envelope = buildEventEnvelope(event, 'core-api/access');
      this.outboxRows.push(envelope);
      return envelope.eventId;
    },
  };
}
