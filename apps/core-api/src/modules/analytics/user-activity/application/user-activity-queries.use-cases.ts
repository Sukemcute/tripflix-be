import { Inject, Injectable } from '@nestjs/common';
import { AccessFacade } from '../../../access/index.js';
import { ContentFacade, EMPTY_PROFILE_STATS, type ProfileStats } from '../../../content/index.js';
import type { UserActivityCounts, UserActivityDay, UserActivityTotals, UserActivityWindow } from '../domain/user-activity.js';
import { USER_ACTIVITY_STORE, type UserActivityEventRow, type UserActivityStore } from './user-activity.use-cases.js';

const RECENT_EVENT_LIMIT = 50;

export interface UserActivityListItem extends UserActivityCounts {
  userId: string;
  /** Null khi tài khoản không còn tồn tại. */
  displayName: string | null;
  email: string | null;
  /** Số liệu hồ sơ từ trước tới nay, không theo khoảng thời gian. */
  profile: ProfileStats;
}

export interface UserActivityDetail {
  userId: string;
  displayName: string;
  email: string;
  createdAt: Date;
  profile: ProfileStats;
  counts: UserActivityCounts;
  recentEvents: UserActivityEventRow[];
}

/** Đọc hành vi cho trang quản trị (TF177). Tên và email lấy qua AccessFacade, không đọc bảng access. */
@Injectable()
export class UserActivityQueries {
  constructor(
    @Inject(USER_ACTIVITY_STORE) private readonly store: UserActivityStore,
    private readonly access: AccessFacade,
    private readonly content: ContentFacade,
  ) {}

  async list(input: UserActivityWindow & { page: number; pageSize: number }) {
    const { rows, total } = await this.store.summarize({
      from: input.from,
      to: input.to,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const userIds = rows.map((row) => row.userId);
    const [contacts, profiles] = await Promise.all([
      this.access.getUserContacts(userIds),
      this.content.getProfileStats(userIds),
    ]);
    const items: UserActivityListItem[] = rows.map((row) => {
      const contact = contacts.get(row.userId);
      return {
        ...row,
        displayName: contact?.displayName ?? null,
        email: contact?.email ?? null,
        profile: profiles.get(row.userId) ?? EMPTY_PROFILE_STATS,
      };
    });
    return { items, total };
  }

  /** Tổng quan toàn hệ thống: tổng từng loại, số người hoạt động và số lượt theo ngày. */
  async overview(window: UserActivityWindow): Promise<{ totals: UserActivityTotals; daily: UserActivityDay[] }> {
    const [totals, daily] = await Promise.all([this.store.totals(window), this.store.daily(window)]);
    return { totals, daily };
  }

  /** Null khi không có tài khoản nào với id này. */
  async detail(userId: string, window: UserActivityWindow): Promise<UserActivityDetail | null> {
    const contact = (await this.access.getUserContacts([userId])).get(userId);
    if (!contact) return null;
    const [counts, recentEvents, profiles] = await Promise.all([
      this.store.summarizeUser(userId, window),
      this.store.recentEvents(userId, window, RECENT_EVENT_LIMIT),
      this.content.getProfileStats([userId]),
    ]);
    return { userId, ...contact, profile: profiles.get(userId) ?? EMPTY_PROFILE_STATS, counts, recentEvents };
  }
}
