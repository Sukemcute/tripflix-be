import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  CLOCK,
  type AccessStore,
  type ActionRateLimiter,
  type Clock,
} from '../../auth/application/ports.js';
import { AccessError } from '../../auth/domain/errors.js';
import {
  PUBLIC_SEARCH_LIMITS,
  PUBLIC_SEARCH_MAX_PAGE,
  PUBLIC_SEARCH_PAGE_SIZE,
  buildIpRateKey,
  buildLatestVisibleBirthDate,
  foldVietnamese,
} from '../domain/name-search.js';

export const TOO_MANY_SEARCHES_MESSAGE = 'Bạn tìm kiếm quá nhanh, vui lòng thử lại sau ít phút';

/** Người dùng hiện ra ở ô tìm kiếm công khai: chỉ phần "bề mặt", không email, vai trò, ngày tạo hay thông tin cá nhân. */
export interface PublicUserSearchPage {
  items: { id: string; displayName: string }[];
  page: number;
  hasMore: boolean;
}

@Injectable()
export class UserSearchUseCases {
  constructor(
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(ACTION_RATE_LIMITER) private readonly limiter: ActionRateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `q` đã chuẩn hoá ở API (normalizeSearchQuery); `ip` là IP người gọi (đã qua trust proxy). */
  async searchPublic(options: { q: string; page: number; ip: string }): Promise<PublicUserSearchPage> {
    const ipKey = buildIpRateKey(options.ip);
    const statuses = await Promise.all(
      PUBLIC_SEARCH_LIMITS.map((w) => this.limiter.consume(`user-search:${w.name}:${ipKey}`, w.limit, w.windowSeconds)),
    );
    const blocked = statuses.filter((s) => s.isBlocked).sort((a, b) => b.retryAfterSeconds - a.retryAfterSeconds)[0];
    if (blocked) throw new AccessError('too_many_attempts', TOO_MANY_SEARCHES_MESSAGE, blocked.retryAfterSeconds);

    // Lấy dư một dòng để biết còn trang sau mà không phải COUNT (không lộ tổng số người khớp).
    const rows = await this.store.users.searchPublic({
      query: foldVietnamese(options.q),
      bornOnOrBefore: buildLatestVisibleBirthDate(this.clock()),
      limit: PUBLIC_SEARCH_PAGE_SIZE + 1,
      offset: (options.page - 1) * PUBLIC_SEARCH_PAGE_SIZE,
    });
    return {
      // Chọn từng trường (allowlist), không trả nguyên bản ghi.
      items: rows.slice(0, PUBLIC_SEARCH_PAGE_SIZE).map((u) => ({ id: u.id, displayName: u.displayName })),
      page: options.page,
      // Trang cuối được phép thì không mời tải tiếp: không có đường đi sâu hơn PUBLIC_SEARCH_MAX_PAGE.
      hasMore: options.page < PUBLIC_SEARCH_MAX_PAGE && rows.length > PUBLIC_SEARCH_PAGE_SIZE,
    };
  }
}
