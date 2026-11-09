import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { buildEventEnvelope, type NewOutboxEvent } from '@tripflix/outbox';
import type {
  AccessStore,
  AuditEntry,
  NewSession,
  OneTimeTokenRepository,
  RegistrationChallenge,
  ProfilePatch,
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
    findByIds: async (ids: string[]) =>
      ids.map((id) => this.userRows.get(id)).filter((u): u is UserRecord => u !== undefined),
    lockById: async (id: string) => this.userRows.get(id) ?? null,
    insert: async ({
      emailVerifiedAt = null,
      ...user
    }: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'> & { emailVerifiedAt?: Date | null }) => {
      if ([...this.userRows.values()].some((u) => u.email === user.email)) return null;
      const row: UserRecord = {
        ...user,
        id: randomUUID(),
        status: 'active',
        createdAt: new Date(),
        emailVerifiedAt,
        personal: { phone: null, dateOfBirth: null, gender: null, nationality: null },
      };
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
    updateProfile: async (id: string, { displayName, ...personal }: ProfilePatch) => {
      const row = this.userRows.get(id);
      if (!row) return null;
      return this.patchUser(id, {
        ...(displayName === undefined ? {} : { displayName }),
        personal: { ...row.personal, ...personal },
      });
    },
    updatePasswordHash: async (id: string, passwordHash: string | null) => this.patchUser(id, { passwordHash }),
    markEmailVerified: async (id: string, at: Date) => {
      const row = this.userRows.get(id);
      if (!row) return null;
      return row.emailVerifiedAt ? row : this.patchUser(id, { emailVerifiedAt: at });
    },
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

  readonly passwordResets = new MemoryOneTimeTokens();
  readonly emailVerifications = new MemoryOneTimeTokens();
  readonly registrationChallengeRows = new Map<string, RegistrationChallenge>();
  readonly registrationChallenges = {
    save: async (challenge: RegistrationChallenge) => {
      this.registrationChallengeRows.set(challenge.email, challenge);
    },
    findUsable: async (email: string, id: string, now: Date) => {
      const row = this.registrationChallengeRows.get(email);
      return row?.id === id && row.expiresAt > now ? row : null;
    },
    consume: async (email: string, id: string, now: Date) => {
      const row = this.registrationChallengeRows.get(email);
      return row?.id === id && row.expiresAt > now && this.registrationChallengeRows.delete(email);
    },
    deleteExpired: async (before: Date) => {
      const expired = [...this.registrationChallengeRows.values()].filter((row) => row.expiresAt < before);
      for (const row of expired) this.registrationChallengeRows.delete(row.email);
      return expired.length;
    },
  };

  /** Dòng của password_resets (test sửa trực tiếp, ví dụ cho hết hạn). */
  get passwordResetRows(): OneTimeTokenRow[] {
    return this.passwordResets.rows;
  }

  get emailVerificationRows(): OneTimeTokenRow[] {
    return this.emailVerifications.rows;
  }

  readonly identityRows: { provider: 'google'; subject: string; userId: string; email: string }[] = [];

  readonly identities = {
    findUserId: async (provider: 'google', subject: string) =>
      this.identityRows.find((i) => i.provider === provider && i.subject === subject)?.userId ?? null,
    insert: async (identity: { provider: 'google'; subject: string; userId: string; email: string }) => {
      if (this.identityRows.some((i) => i.provider === identity.provider && i.subject === identity.subject)) return false;
      this.identityRows.push(identity);
      return true;
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

export interface OneTimeTokenRow {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** password_resets, email_verifications trong bộ nhớ. */
class MemoryOneTimeTokens implements OneTimeTokenRepository {
  readonly rows: OneTimeTokenRow[] = [];

  async insert(token: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.rows.push({ ...token, usedAt: null });
  }

  async deleteUnusedByUser(userId: string) {
    return this.remove((r) => r.userId === userId && !r.usedAt);
  }

  async findUsable(tokenHash: string, now: Date) {
    const row = this.find(tokenHash, now);
    return row ? { userId: row.userId } : null;
  }

  async consume(tokenHash: string, now: Date) {
    const row = this.find(tokenHash, now);
    if (!row) return null;
    row.usedAt = now;
    return { userId: row.userId };
  }

  async deleteExpired(before: Date) {
    return this.remove((r) => r.expiresAt < before);
  }

  private find(tokenHash: string, now: Date) {
    return this.rows.find((r) => r.tokenHash === tokenHash && !r.usedAt && r.expiresAt > now);
  }

  private remove(match: (r: OneTimeTokenRow) => boolean): number {
    const kept = this.rows.filter((r) => !match(r));
    const removed = this.rows.length - kept.length;
    this.rows.splice(0, this.rows.length, ...kept);
    return removed;
  }
}
