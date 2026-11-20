import type { Db } from '@tripflix/db';
import { sql } from 'drizzle-orm';
import { posts, trendSignals } from '../../db/schema/index.js';
import type { TrendSignal } from '../domain/trend-signal.js';
import type { TrendSignalStore } from '../application/ports.js';

export class DrizzleTrendSignalStore implements TrendSignalStore {
  constructor(private readonly getDb: () => Db) {}

  async record(signal: TrendSignal): Promise<boolean> {
    // Chọn từ posts thay vì insert thẳng: bài đã bị xoá cứng thì không ghi, thay vì lỗi khoá ngoại làm consumer giao lại mãi.
    const result = await this.getDb().execute<{ ok: number }>(sql`
      insert into ${trendSignals} (post_id, kind, actor_key, is_guest, occurred_at)
      select ${posts.id}, ${signal.kind}, ${signal.actorKey}, ${signal.isGuest}, ${signal.occurredAt}::timestamptz
      from ${posts}
      where ${posts.id} = ${signal.postId}::uuid
      on conflict (post_id, kind, actor_key) do nothing
      returning 1 as ok
    `);
    return result.rows.length > 0;
  }

  async purgeOlderThan(before: Date, limit: number): Promise<number> {
    const result = await this.getDb().execute<{ ok: number }>(sql`
      delete from ${trendSignals}
      where ${trendSignals.id} in (
        select ${trendSignals.id} from ${trendSignals}
        where ${trendSignals.occurredAt} < ${before.toISOString()}::timestamptz
        limit ${limit}
      )
      returning 1 as ok
    `);
    return result.rows.length;
  }
}
