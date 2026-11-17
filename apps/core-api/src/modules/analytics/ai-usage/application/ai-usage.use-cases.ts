import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import { sumAiUsage, toAiUsageRecord, type AiUsageQuery, type AiUsageRecord, type AiUsageRow } from '../domain/ai-usage.js';

export const AI_USAGE_STORE = Symbol('AI_USAGE_STORE');

export interface AiUsageStore {
  /** Ghi một dòng; eventId đã có thì bỏ qua (giao lại không đếm trùng). Trả về có ghi mới hay không. */
  insert(record: AiUsageRecord): Promise<boolean>;
  summarize(query: AiUsageQuery): Promise<AiUsageRow[]>;
}

/** Chi phí AI (TF95): nhận sự kiện ai.usage.recorded, trả báo cáo cho superadmin. Một câu lệnh mỗi việc, không cần transaction. */
@Injectable()
export class AiUsageUseCases {
  constructor(@Inject(AI_USAGE_STORE) private readonly store: AiUsageStore) {}

  async record(event: EventEnvelope): Promise<boolean> {
    const record = toAiUsageRecord(event);
    return record ? this.store.insert(record) : false;
  }

  async report(query: AiUsageQuery) {
    const rows = await this.store.summarize(query);
    return { rows, total: sumAiUsage(rows) };
  }
}
