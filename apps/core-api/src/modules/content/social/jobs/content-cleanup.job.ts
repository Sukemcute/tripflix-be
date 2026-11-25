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
import { contentIdempotencyKeys, contentOutboxEvents } from '../../db/schema/index.js';

export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_BATCH_SIZE = 5_000;
/** Giữ sự kiện đã gửi 7 ngày để còn tra cứu khi consumer báo thiếu (giống access, commerce). */
export const PUBLISHED_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ContentCleanupResult {
  expiredIdempotencyKeys: number;
  publishedEvents: number;
}

async function deleteExpiredIdempotencyBatch(db: Db, before: Date, limit: number): Promise<number> {
  const table = contentIdempotencyKeys;
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

export async function runContentCleanup(deps: {
  deleteExpiredIdempotencyBatch: (before: Date, limit: number) => Promise<number>;
  deletePublishedEventsBefore: (before: Date) => Promise<number>;
  now: Date;
}): Promise<ContentCleanupResult> {
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

/**
 * Dọn khoá idempotency hết hạn và outbox content đã gửi quá 7 ngày: lúc worker khởi động rồi mỗi 24 giờ, chỉ khi
 * APP_ROLE là worker hoặc all. Nhiều worker cùng chạy vẫn an toàn (chỉ DELETE theo điều kiện thời gian).
 */
@Injectable()
export class ContentCleanupJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ContentCleanupJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test' || (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all')) return;
    const db = createDb(this.pools.content);
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
      const result = await runContentCleanup({
        deleteExpiredIdempotencyBatch: (before, limit) => deleteExpiredIdempotencyBatch(db, before, limit),
        deletePublishedEventsBefore: (before) => deletePublishedBefore(db, contentOutboxEvents, before),
        now: new Date(),
      });
      this.logger.log(result, 'Đã dọn khoá idempotency hết hạn và sự kiện content đã gửi quá 7 ngày');
    } catch (err) {
      this.logger.error({ err }, 'Dọn dữ liệu content lỗi, sẽ thử lại ở lượt sau');
    }
  }
}
