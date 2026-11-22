import type { Db } from '@tripflix/db';
import { and, gte, lt, sql } from 'drizzle-orm';
import { aiUsageEvents } from '../../db/schema/index.js';
import type { AiUsageStore } from '../application/ai-usage.use-cases.js';
import type { AiUsageGroup, AiUsageQuery, AiUsageRecord, AiUsageRow } from '../domain/ai-usage.js';

// Ngày tính theo giờ Việt Nam để báo cáo khớp với ngày người vận hành thấy.
const GROUP_KEY: Record<AiUsageGroup, ReturnType<typeof sql<string>>> = {
  feature: sql<string>`${aiUsageEvents.feature}`,
  model: sql<string>`${aiUsageEvents.model}`,
  day: sql<string>`to_char(${aiUsageEvents.occurredAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`,
};

export class DrizzleAiUsageStore implements AiUsageStore {
  constructor(private readonly db: Db) {}

  async insert(record: AiUsageRecord): Promise<boolean> {
    const rows = await this.db
      .insert(aiUsageEvents)
      .values(record)
      .onConflictDoNothing({ target: aiUsageEvents.id })
      .returning({ id: aiUsageEvents.id });
    return rows.length > 0;
  }

  async summarize({ from, to, groupBy }: AiUsageQuery): Promise<AiUsageRow[]> {
    const key = GROUP_KEY[groupBy];
    const rows = await this.db
      .select({
        key,
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)::bigint`,
        costUsd: sql<number>`coalesce(sum(${aiUsageEvents.costUsd}), 0)`,
        unpricedCalls: sql<number>`count(*) filter (where ${aiUsageEvents.feature} = 'cover_ocr' and ${aiUsageEvents.inputTokens} is null)::int`,
      })
      .from(aiUsageEvents)
      .where(and(gte(aiUsageEvents.occurredAt, from), lt(aiUsageEvents.occurredAt, to)))
      .groupBy(key)
      .orderBy(key);
    // pg trả bigint và numeric dạng chuỗi.
    return rows.map((r) => ({
      key: r.key,
      calls: Number(r.calls),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
      costUsd: Number(r.costUsd),
      unpricedCalls: Number(r.unpricedCalls),
    }));
  }
}
