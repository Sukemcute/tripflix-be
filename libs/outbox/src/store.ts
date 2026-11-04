import type { EventEnvelope } from '@tripflix/contracts';
import type { Db } from '@tripflix/db';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { OutboxTable } from './table.js';

export interface ClaimedOutboxEvent {
  envelope: EventEnvelope;
  attempts: number;
}

/**
 * Truy cập bảng outbox cho relay; có bản Drizzle và bản bộ nhớ (test).
 * Giữ thứ tự: chỉ giành sự kiện xảy ra trước sự kiện chưa gửi sớm nhất đang bị khoá, nên sự kiện mới
 * không vượt lên trước sự kiện đang chờ thử lại.
 */
export interface OutboxStore {
  /** Giành tối đa `limit` sự kiện chưa gửi, khoá trong `lockSeconds`, theo thứ tự xảy ra. */
  claimBatch(limit: number, lockSeconds: number): Promise<ClaimedOutboxEvent[]>;
  markPublished(eventId: string): Promise<void>;
  /** Tăng attempts, giữ khoá: sự kiện được thử lại khi hết khoá. */
  markFailed(eventId: string, error: string): Promise<void>;
}

type OutboxRow = OutboxTable['$inferSelect'];

function mapEnvelope(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString(),
    producer: row.producer,
    ...(row.traceId ? { traceId: row.traceId } : {}),
    userId: row.userId,
    payload: row.payload,
  };
}

export class DrizzleOutboxStore implements OutboxStore {
  constructor(
    private readonly db: Db,
    private readonly table: OutboxTable,
  ) {}

  async claimBatch(limit: number, lockSeconds: number): Promise<ClaimedOutboxEvent[]> {
    const t = this.table;
    // Mốc chặn: sự kiện chưa gửi sớm nhất đang bị khoá (đang gửi hoặc chờ thử lại). Không có thì không chặn.
    const earliestLocked = sql`(select min(${t.occurredAt}) from ${t} where ${t.publishedAt} is null and ${t.lockedUntil} >= now())`;
    // SKIP LOCKED: nhiều replica relay chạy cùng lúc không giành trùng dòng.
    const candidates = this.db
      .select({ id: t.id })
      .from(t)
      .where(
        and(
          isNull(t.publishedAt),
          or(isNull(t.lockedUntil), lt(t.lockedUntil, sql`now()`)),
          sql`(${earliestLocked} is null or ${t.occurredAt} < ${earliestLocked})`,
        ),
      )
      .orderBy(asc(t.occurredAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    const rows = await this.db
      .update(t)
      .set({ lockedUntil: sql`now() + make_interval(secs => ${lockSeconds})` })
      .where(inArray(t.id, candidates))
      .returning();
    return rows
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((row) => ({ envelope: mapEnvelope(row), attempts: row.attempts }));
  }

  async markPublished(eventId: string): Promise<void> {
    await this.db
      .update(this.table)
      .set({ publishedAt: sql`now()`, lockedUntil: null, lastError: null })
      .where(eq(this.table.id, eventId));
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    // Giữ locked_until: dòng được thử lại khi hết khoá, tự giãn cách giữa các lần thử.
    await this.db
      .update(this.table)
      .set({ attempts: sql`${this.table.attempts} + 1`, lastError: error.slice(0, 1000) })
      .where(eq(this.table.id, eventId));
  }
}

/** Bản bộ nhớ của OutboxStore, cùng quy tắc giành khoá; dùng cho test. */
export class MemoryOutboxStore implements OutboxStore {
  readonly rows = new Map<
    string,
    { envelope: EventEnvelope; publishedAt: number | null; lockedUntil: number | null; attempts: number; lastError: string | null }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  add(envelope: EventEnvelope): void {
    this.rows.set(envelope.eventId, { envelope, publishedAt: null, lockedUntil: null, attempts: 0, lastError: null });
  }

  async claimBatch(limit: number, lockSeconds: number): Promise<ClaimedOutboxEvent[]> {
    const now = this.now();
    const occurredAt = (r: { envelope: EventEnvelope }) => Date.parse(r.envelope.occurredAt);
    const pending = [...this.rows.values()].filter((r) => r.publishedAt === null);
    const lockedTimes = pending.filter((r) => r.lockedUntil !== null && r.lockedUntil >= now).map(occurredAt);
    const earliestLocked = lockedTimes.length > 0 ? Math.min(...lockedTimes) : Number.POSITIVE_INFINITY;
    const claimable = pending
      .filter((r) => (r.lockedUntil === null || r.lockedUntil < now) && occurredAt(r) < earliestLocked)
      .sort((a, b) => occurredAt(a) - occurredAt(b))
      .slice(0, limit);
    for (const row of claimable) row.lockedUntil = now + lockSeconds * 1000;
    return claimable.map((r) => ({ envelope: r.envelope, attempts: r.attempts }));
  }

  async markPublished(eventId: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) Object.assign(row, { publishedAt: this.now(), lockedUntil: null, lastError: null });
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    const row = this.rows.get(eventId);
    if (row) Object.assign(row, { attempts: row.attempts + 1, lastError: error });
  }
}
