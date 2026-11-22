import type { Db } from '@tripflix/db';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { IdempotencyKeysTable } from './table.js';

/** Kết quả giữ chỗ cho một (scope, key). */
export type IdempotencyBeginResult =
  | { kind: 'started' }
  | { kind: 'replay'; requestHash: string; responseStatus: number; responseBody: unknown }
  | { kind: 'in_progress'; requestHash: string };

/**
 * Dòng `processing` cũ hơn mức này coi như tiến trình đã chết giữa chừng (deploy, hết bộ nhớ, bị kill) và cho request mới
 * giữ lại (L3, rà soát 13/11). Trước đây phải đợi hết 24 giờ, khách gửi lại cùng key nhận 409 suốt thời gian đó.
 * Request thật dài nhất là trả tiền: cổng thanh toán tối đa 15 giây, mỗi câu SQL tối đa 10 giây (APP_STATEMENT_TIMEOUT_MS),
 * nên 60 giây đủ xa để không chạy chồng một request còn sống. Chạy lại an toàn vì lệnh bên trong tự chống trùng.
 */
export const STALE_PROCESSING_SECONDS = 60;

export interface IdempotencyStore {
  /** Giữ chỗ (scope, key). Dòng cũ đã hết hạn, hoặc còn `processing` quá STALE_PROCESSING_SECONDS, thì coi như chưa có. */
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
    // Ghi đè khi dòng cũ đã hết hạn, hoặc còn `processing` quá lâu (tiến trình xử lý đã chết); còn lại giữ nguyên.
    const inserted = await this.db
      .insert(t)
      .values({ scope, key, requestHash, status: 'processing', expiresAt })
      .onConflictDoUpdate({
        target: [t.scope, t.key],
        set: { requestHash, status: 'processing', responseStatus: null, responseBody: null, createdAt: sql`now()`, expiresAt },
        setWhere: or(lt(t.expiresAt, sql`now()`), and(eq(t.status, 'processing'), lt(t.createdAt, sql`now() - make_interval(secs => ${STALE_PROCESSING_SECONDS})`))),
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
    { requestHash: string; status: 'processing' | 'completed'; responseStatus: number | null; responseBody: unknown; createdAt: number; expiresAt: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  async begin(scope: string, key: string, requestHash: string, ttlSeconds: number): Promise<IdempotencyBeginResult> {
    const id = `${scope}\u0000${key}`;
    const row = this.rows.get(id);
    const isStale = row?.status === 'processing' && row.createdAt < this.now() - STALE_PROCESSING_SECONDS * 1000;
    if (!row || row.expiresAt < this.now() || isStale) {
      this.rows.set(id, {
        requestHash,
        status: 'processing',
        responseStatus: null,
        responseBody: null,
        createdAt: this.now(),
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
