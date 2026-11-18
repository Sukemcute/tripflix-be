import { Inject, Injectable } from '@nestjs/common';
import { AccessFacade } from '../../../access/index.js';
import { fillBuckets, type AiBucket, type AiTraceRow, type AiTraceStep, type AiUserUsageRow, type AiWindow } from '../domain/ai-insights.js';
import { AI_INSIGHTS_STORE, type AiInsightsStore, type AiTraceFilter } from './ai-insights.store.js';

export interface WithContact {
  /** Null khi tài khoản không còn tồn tại. */
  displayName: string | null;
  email: string | null;
}

export type AiUserUsageItem = AiUserUsageRow & WithContact;
export type AiTraceItem = AiTraceRow & WithContact;

/** Chi phí và trace AI theo thời gian, người dùng và lượt chat (SCRUM-179). Tên, email lấy qua AccessFacade. */
@Injectable()
export class AiInsightsQueries {
  constructor(
    @Inject(AI_INSIGHTS_STORE) private readonly store: AiInsightsStore,
    private readonly access: AccessFacade,
  ) {}

  async timeseries(query: AiWindow & { bucket: AiBucket; feature?: string | undefined; model?: string | undefined }) {
    const points = await this.store.timeseries(query);
    return fillBuckets(points, query.from, query.to, query.bucket);
  }

  async users(query: AiWindow & { userId?: string | undefined; page: number; pageSize: number }) {
    const { rows, total } = await this.store.userRanking({
      from: query.from,
      to: query.to,
      userId: query.userId,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: await this.withContacts(rows), total };
  }

  async traces(query: AiWindow & AiTraceFilter & { page: number; pageSize: number }) {
    const { rows, total } = await this.store.traceList({
      from: query.from,
      to: query.to,
      userId: query.userId,
      answerKind: query.answerKind,
      minCostUsd: query.minCostUsd,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: await this.withContacts(rows), total };
  }

  /** Null khi không có lượt chat nào với turnId này. */
  async trace(turnId: string): Promise<{ trace: AiTraceItem; steps: AiTraceStep[] } | null> {
    const found = await this.store.traceDetail(turnId);
    if (!found) return null;
    const [trace] = await this.withContacts([found.trace]);
    return trace ? { trace, steps: found.steps } : null;
  }

  private async withContacts<T extends { userId: string }>(rows: readonly T[]): Promise<(T & WithContact)[]> {
    const contacts = await this.access.getUserContacts(rows.map((row) => row.userId));
    return rows.map((row) => {
      const contact = contacts.get(row.userId);
      return { ...row, displayName: contact?.displayName ?? null, email: contact?.email ?? null };
    });
  }
}
