import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDb, type Db } from '@tripflix/db';
import { deletePublishedBefore } from '@tripflix/outbox';
import { and, lt, sql } from 'drizzle-orm';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, type DbPools } from '../../../../platform/tokens.js';
import { commerceIdempotencyKeys, commerceOutboxEvents } from '../../db/schema/index.js';
import { COMMERCE_CLOCK, type Clock } from '../application/ports.js';

export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_BATCH_SIZE = 5_000;
/** Giữ sự kiện đã gửi 7 ngày để còn tra cứu khi consumer báo thiếu. */
export const PUBLISHED_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CommerceCleanupResult {
  expiredIdempotencyKeys: number;
  publishedEvents: number;
}

export async function deleteExpiredCommerceIdempotencyBatch(
  db: Db,
  before: Date,
  limit: number,
): Promise<number> {
  const table = commerceIdempotencyKeys;
  // Giới hạn mỗi câu lệnh để không giữ khoá quá lâu khi bảng lớn.
  const rows = await db
    .delete(table)
    .where(
      and(
        lt(table.expiresAt, before),
        sql`(${table.scope}, ${table.key}) in (
      select ${table.scope}, ${table.key} from ${table}
      where ${lt(table.expiresAt, before)} limit ${limit}
    )`,
      ),
    )
    .returning({ scope: table.scope });
  return rows.length;
}

export async function runCommerceCleanup(deps: {
  deleteExpiredIdempotencyBatch: (before: Date, limit: number) => Promise<number>;
  deletePublishedEventsBefore: (before: Date) => Promise<number>;
  now: Date;
}): Promise<CommerceCleanupResult> {
  let expiredIdempotencyKeys = 0;
  for (;;) {
    const deleted = await deps.deleteExpiredIdempotencyBatch(deps.now, IDEMPOTENCY_BATCH_SIZE);
    expiredIdempotencyKeys += deleted;
    if (deleted < IDEMPOTENCY_BATCH_SIZE) break;
    // Nhường vòng lặp sự kiện để các tác vụ khác vẫn được xử lý giữa các lô.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const publishedEvents = await deps.deletePublishedEventsBefore(
    new Date(deps.now.getTime() - PUBLISHED_EVENT_RETENTION_MS),
  );
  return { expiredIdempotencyKeys, publishedEvents };
}

@Injectable()
export class CommerceCleanupJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CommerceCleanupJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(COMMERCE_CLOCK) private readonly now: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    const db = createDb(this.pools.commerce);
    const tick = () => {
      // Bỏ lượt đang trùng để không nhân đôi tải dọn dữ liệu.
      this.running ??= this.runOnce(db).finally(() => {
        this.running = undefined;
      });
    };
    tick();
    this.timer = setInterval(tick, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private async runOnce(db: Db): Promise<void> {
    try {
      const result = await runCommerceCleanup({
        deleteExpiredIdempotencyBatch: (before, limit) =>
          deleteExpiredCommerceIdempotencyBatch(db, before, limit),
        deletePublishedEventsBefore: (before) => deletePublishedBefore(db, commerceOutboxEvents, before),
        now: this.now(),
      });
      this.logger.log(result, 'Đã dọn khoá idempotency hết hạn và sự kiện commerce đã gửi quá 7 ngày');
    } catch (err) {
      this.logger.error({ err }, 'Dọn dữ liệu commerce lỗi, sẽ thử lại ở lượt sau');
    }
  }
}
