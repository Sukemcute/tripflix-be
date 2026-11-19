import type { Db } from '@tripflix/db';
import { sql, type SQL } from 'drizzle-orm';
import type { AiInsightsStore, AiTraceFilter } from '../application/ai-insights.store.js';
import type { AiBucket, AiTimePoint, AiTraceRow, AiTraceStep, AiUserUsageRow, AiWindow } from '../domain/ai-insights.js';

type Raw = Record<string, unknown>;

/** Drizzle bản này trả mảng dòng hoặc object có `rows` tuỳ chế độ: nhận cả hai. */
function rowsOf(result: unknown): Raw[] {
  if (Array.isArray(result)) return result as Raw[];
  return ((result as { rows?: Raw[] } | null)?.rows ?? []) as Raw[];
}

// Câu SQL thô không qua cột khai báo nên pg trả thời gian dạng chuỗi và bigint, numeric dạng chuỗi (bài học #276).
const toDate = (value: unknown) => new Date(value as string | Date);
const toNumber = (value: unknown) => Number(value ?? 0);
const toNullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const toNullableText = (value: unknown) => (typeof value === 'string' ? value : null);

export function toTimePoint(row: Raw): AiTimePoint {
  return {
    at: toDate(row.at),
    calls: toNumber(row.calls),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    costUsd: toNumber(row.cost_usd),
  };
}

export function toUserRow(row: Raw): AiUserUsageRow {
  return {
    userId: String(row.user_id),
    calls: toNumber(row.calls),
    conversations: toNumber(row.conversations),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    costUsd: toNumber(row.cost_usd),
    lastAt: toDate(row.last_at),
  };
}

export function toTraceRow(row: Raw): AiTraceRow {
  return {
    eventId: String(row.event_id),
    turnId: toNullableText(row.turn_id),
    userId: String(row.user_id),
    occurredAt: toDate(row.occurred_at),
    question: toNullableText(row.question),
    intent: toNullableText(row.intent),
    answerKind: toNullableText(row.answer_kind),
    isAction: row.is_action === true || row.is_action === 'true' || row.is_action === 't',
    latencyMs: toNullableNumber(row.latency_ms),
    steps: toNumber(row.steps),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    costUsd: toNumber(row.cost_usd),
  };
}

export function toStepRow(row: Raw): AiTraceStep {
  return {
    id: String(row.id),
    step: toNullableText(row.step),
    model: String(row.model),
    inputTokens: toNullableNumber(row.input_tokens),
    outputTokens: toNullableNumber(row.output_tokens),
    costUsd: toNumber(row.cost_usd),
    latencyMs: toNullableNumber(row.latency_ms),
    occurredAt: toDate(row.occurred_at),
    isEstimated: row.is_estimated === true || row.is_estimated === 't',
  };
}

const ts = (value: Date) => sql`${value.toISOString()}::timestamptz`;

export class DrizzleAiInsightsStore implements AiInsightsStore {
  constructor(private readonly db: Db) {}

  async timeseries({ from, to, bucket, feature, model }: AiWindow & { bucket: AiBucket; feature?: string | undefined; model?: string | undefined }) {
    const unit = bucket === 'hour' ? sql`'hour'` : sql`'day'`;
    const filters: SQL[] = [sql`occurred_at >= ${ts(from)}`, sql`occurred_at < ${ts(to)}`];
    if (feature) filters.push(sql`feature = ${feature}`);
    if (model) filters.push(sql`model = ${model}`);
    const result = await this.db.execute(sql`
      select date_trunc(${unit}, occurred_at, 'Asia/Ho_Chi_Minh') as at,
        count(*)::int as calls,
        coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(cost_usd), 0) as cost_usd
      from analytics.ai_usage_events
      where ${sql.join(filters, sql` and `)}
      group by 1
      order by 1`);
    return rowsOf(result).map(toTimePoint);
  }

  async userRanking({ from, to, userId, limit, offset }: AiWindow & { userId?: string | undefined; limit: number; offset: number }) {
    const filters: SQL[] = [sql`user_id is not null`, sql`occurred_at >= ${ts(from)}`, sql`occurred_at < ${ts(to)}`];
    if (userId) filters.push(sql`user_id = ${userId}::uuid`);
    const result = await this.db.execute(sql`
      with ranked as (
        select user_id,
          count(*)::int as calls,
          count(distinct conversation_id)::int as conversations,
          coalesce(sum(input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(cost_usd), 0) as cost_usd,
          max(occurred_at) as last_at
        from analytics.ai_usage_events
        where ${sql.join(filters, sql` and `)}
        group by user_id
      )
      select *, count(*) over() as total
      from ranked
      order by cost_usd desc, user_id
      limit ${limit} offset ${offset}`);
    const rows = rowsOf(result);
    return { rows: rows.map(toUserRow), total: toNumber(rows[0]?.total) };
  }

  async traceList({ from, to, userId, answerKind, minCostUsd, limit, offset }: AiWindow & AiTraceFilter & { limit: number; offset: number }) {
    const filters: SQL[] = [sql`c.kind = 'chat'`, sql`c.occurred_at >= ${ts(from)}`, sql`c.occurred_at < ${ts(to)}`];
    if (userId) filters.push(sql`c.user_id = ${userId}::uuid`);
    if (answerKind) filters.push(sql`c.detail->>'answerKind' = ${answerKind}`);
    return this.traceRows(filters, minCostUsd, limit, offset);
  }

  async traceDetail(turnId: string) {
    const { rows } = await this.traceRows([sql`c.kind = 'chat'`, sql`c.detail->>'turnId' = ${turnId}`], undefined, 1, 0);
    const trace = rows[0];
    if (!trace) return null;
    const result = await this.db.execute(sql`
      select id, step, model, input_tokens, output_tokens, cost_usd, latency_ms, occurred_at, is_estimated
      from analytics.ai_usage_events
      where turn_id = ${turnId}::uuid
      order by occurred_at, id`);
    return { trace, steps: rowsOf(result).map(toStepRow) };
  }

  async unlinkBefore(cutoff: Date): Promise<number> {
    const result = await this.db.execute(sql`
      update analytics.ai_usage_events
      set user_id = null, conversation_id = null, turn_id = null
      where occurred_at < ${ts(cutoff)}
        and (user_id is not null or conversation_id is not null or turn_id is not null)
      returning id`);
    return rowsOf(result).length;
  }

  /** Lượt chat nối với các bước gọi LLM cùng turnId (bước chưa có turnId thì không nối được: token bằng 0). */
  private async traceRows(filters: SQL[], minCostUsd: number | undefined, limit: number, offset: number) {
    const having = minCostUsd !== undefined ? sql`having coalesce(sum(a.cost_usd), 0) >= ${minCostUsd}` : sql``;
    const result = await this.db.execute(sql`
      select c.id as event_id,
        nullif(c.detail->>'turnId', '') as turn_id,
        c.user_id,
        c.occurred_at,
        c.detail->>'question' as question,
        c.detail->>'intent' as intent,
        c.detail->>'answerKind' as answer_kind,
        coalesce((c.detail->>'isAction')::boolean, false) as is_action,
        (c.detail->>'latencyMs')::int as latency_ms,
        count(a.id)::int as steps,
        coalesce(sum(a.input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(a.output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(a.cost_usd), 0) as cost_usd,
        count(*) over() as total
      from analytics.user_activity_events c
      left join analytics.ai_usage_events a on a.turn_id = nullif(c.detail->>'turnId', '')::uuid
      where ${sql.join(filters, sql` and `)}
      group by c.id
      ${having}
      order by c.occurred_at desc, c.id
      limit ${limit} offset ${offset}`);
    const rows = rowsOf(result);
    return { rows: rows.map(toTraceRow), total: toNumber(rows[0]?.total) };
  }
}
