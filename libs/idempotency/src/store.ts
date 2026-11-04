import type { Db } from '@tripflix/db';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { IdempotencyKeysTable } from './table.js';

/** Kết quả giữ chỗ cho một (scope, key). */
export type IdempotencyBeginResult =
  | { kind: 'started' }
  | { kind: 'replay'; requestHash: string; responseStatus: number; responseBody: unknown }
  | { kind: 'in_progress'; requestHash: string };

export interface IdempotencyStore {
  /** Giữ chỗ (scope, key). Dòng cũ đã hết hạn thì coi như chưa có. */
  begin(scope: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyBeginResult>;
  /** Lưu kết quả lần đầu để trả lại khi request bị gửi lại. */
  complete(scope: string, key: string, responseStatus: number, responseBody: unknown): Promise<void>;
  /** Xoá chỗ đã giữ khi xử lý lỗi, để client gửi lại được. */
  abort(scope: string, key: string): Promise<void>;
}

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly db: Db,
    private readonly table: IdempotencyKeysTable,
  ) {}

  async begin(scope: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyBeginResult> {
    const t = this.table;
    const expiresAt = sql`now() + make_interval(secs => ${ttlSeconds})`;
    // Ghi đè chỉ khi dòng cũ đã hết hạn; còn hạn thì giữ nguyên để trả lại kết quả cũ.
    const inserted = await this.db
      .insert(t)
      .values({ scope, key, requestHash, status: 'processing', expiresAt })
      .onConflictDoUpdate({
        target: [t.scope, t.key],
        set: { requestHash, status: 'processing', responseStatus: null, responseBody: null, createdAt: sql`now()`, expiresAt },
        setWhere: lt(t.expiresAt, sql`now()`),
      })
      .returning({ scope: t.scope });
    if (inserted.length > 0) return { kind: 'started' };

    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.scope, scope), eq(t.key, key)))
      .limit(1);
    if (!row) return { kind: 'in_progress', requestHash };
    if (row.status === 'completed' && row.responseStatus !== null) {
      return { kind: 'replay', requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody };
    }
    return { kind: 'in_progress', requestHash: row.requestHash };
  }

  async complete(scope: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const t = this.table;
    await this.db
      .update(t)
      .set({ status: 'completed', responseStatus, responseBody: responseBody ?? null })
      .where(and(eq(t.scope, scope), eq(t.key, key)));
  }

  async abort(scope: string, key: string): Promise<void> {
    const t = this.table;
    await this.db.delete(t).where(and(eq(t.scope, scope), eq(t.key, key), eq(t.status, 'processing')));
  }
}

/** Bản bộ nhớ, cùng quy tắc; dùng cho test. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly rows = new Map<
    string,
    { requestHash: string; status: 'processing' | 'completed'; responseStatus: number | null; responseBody: unknown; expiresAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  async begin(scope: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyBeginResult> {
    const id = `${scope}\u0000${key}`;
    const row = this.rows.get(id);
    if (!row || row.expiresAt < this.now()) {
      this.rows.set(id, {
        requestHash,
        status: 'processing',
        responseStatus: null,
        responseBody: null,
        expiresAt: this.now() + ttlSeconds * 1000,
      });
      return { kind: 'started' };
    }
    if (row.status === 'completed' && row.responseStatus !== null) {
      return { kind: 'replay', requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody };
    }
    return { kind: 'in_progress', requestHash: row.requestHash };
  }

  async complete(scope: string, key: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const row = this.rows.get(`${scope}\u0000${key}`);
    if (row) Object.assign(row, { status: 'completed', responseStatus, responseBody: responseBody ?? null });
  }

  async abort(scope: string, key: string): Promise<void> {
    const id = `${scope}\u0000${key}`;
    if (this.rows.get(id)?.status === 'processing') this.rows.delete(id);
  }
}
