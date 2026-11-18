import { Inject, Injectable } from '@nestjs/common';
import { AccessFacade } from '../../../access/index.js';
import type { UserActivityCounts, UserActivityWindow } from '../domain/user-activity.js';
import { USER_ACTIVITY_STORE, type UserActivityEventRow, type UserActivityStore } from './user-activity.use-cases.js';

const RECENT_EVENT_LIMIT = 50;

export interface UserActivityListItem extends UserActivityCounts {
  userId: string;
  /** Null khi tài khoản không còn tồn tại. */
  displayName: string | null;
  email: string | null;
}

export interface UserActivityDetail {
  userId: string;
  displayName: string;
  email: string;
  createdAt: Date;
  counts: UserActivityCounts;
  recentEvents: UserActivityEventRow[];
}

/** Đọc hành vi cho trang quản trị (TF177). Tên và email lấy qua AccessFacade, không đọc bảng access. */
@Injectable()
export class UserActivityQueries {
  constructor(
    @Inject(USER_ACTIVITY_STORE) private readonly store: UserActivityStore,
    private readonly access: AccessFacade,
  ) {}

  async list(input: UserActivityWindow & { page: number; pageSize: number }) {
    const { rows, total } = await this.store.summarize({
      from: input.from,
      to: input.to,
      limit: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    });
    const contacts = await this.access.getUserContacts(rows.map((row) => row.userId));
    const items: UserActivityListItem[] = rows.map((row) => {
      const contact = contacts.get(row.userId);
      return { ...row, displayName: contact?.displayName ?? null, email: contact?.email ?? null };
    });
    return { items, total };
  }

  /** Null khi không có tài khoản nào với id này. */
  async detail(userId: string, window: UserActivityWindow): Promise<UserActivityDetail | null> {
    const contact = (await this.access.getUserContacts([userId])).get(userId);
    if (!contact) return null;
    const [counts, recentEvents] = await Promise.all([
      this.store.summarizeUser(userId, window),
      this.store.recentEvents(userId, window, RECENT_EVENT_LIMIT),
    ]);
    return { userId, ...contact, counts, recentEvents };
  }
}
