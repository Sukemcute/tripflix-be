import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope } from '@tripflix/contracts';
import type { UserActivityCounts, UserActivityRecord, UserActivityWindow } from '../domain/user-activity.js';
import { toUserActivityRecord } from '../domain/user-activity.js';

export const USER_ACTIVITY_STORE = Symbol('USER_ACTIVITY_STORE');

export interface UserActivitySummaryRow extends UserActivityCounts {
  userId: string;
}

export interface UserActivityEventRow {
  id: string;
  kind: string;
  occurredAt: Date;
  targetId: string | null;
  detail: Record<string, unknown>;
}

export interface UserActivityStore {
  /** Ghi một dòng; id đã có thì bỏ qua. Trả về có ghi mới hay không. */
  insert(record: UserActivityRecord): Promise<boolean>;
  /** Người có hoạt động trong cửa sổ, mới hoạt động nhất trước. */
  summarize(window: UserActivityWindow & { limit: number; offset: number }): Promise<{ rows: UserActivitySummaryRow[]; total: number }>;
  summarizeUser(userId: string, window: UserActivityWindow): Promise<UserActivityCounts>;
  recentEvents(userId: string, window: UserActivityWindow, limit: number): Promise<UserActivityEventRow[]>;
  /** Xoá mọi dòng xảy ra trước `cutoff`; trả về số dòng đã xoá. */
  purgeBefore(cutoff: Date): Promise<number>;
}

/** Ghi hành vi từ sự kiện (TF177). Không phụ thuộc module access, nên consumer dùng được mà không kéo access vào analytics. */
@Injectable()
export class UserActivityUseCases {
  constructor(@Inject(USER_ACTIVITY_STORE) private readonly store: UserActivityStore) {}

  async record(event: EventEnvelope): Promise<boolean> {
    const record = toUserActivityRecord(event);
    return record ? this.store.insert(record) : false;
  }
}
