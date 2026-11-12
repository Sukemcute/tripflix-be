import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_STORE, type AccessStore } from '../../auth/application/ports.js';
import { foldVietnamese } from '../domain/name-search.js';

export const USER_SEARCH_PAGE_SIZE = 20;

/** Người dùng hiện ra ở ô tìm kiếm công khai: không có email hay vai trò. */
export interface PublicUserSearchPage {
  items: { id: string; displayName: string }[];
  page: number;
  hasMore: boolean;
}

@Injectable()
export class UserSearchUseCases {
  constructor(@Inject(ACCESS_STORE) private readonly store: AccessStore) {}

  async searchPublic(options: { q: string; page: number }): Promise<PublicUserSearchPage> {
    // Lấy dư một dòng để biết còn trang sau mà không phải COUNT.
    const rows = await this.store.users.searchPublic({
      query: foldVietnamese(options.q),
      limit: USER_SEARCH_PAGE_SIZE + 1,
      offset: (options.page - 1) * USER_SEARCH_PAGE_SIZE,
    });
    return {
      items: rows.slice(0, USER_SEARCH_PAGE_SIZE).map((u) => ({ id: u.id, displayName: u.displayName })),
      page: options.page,
      hasMore: rows.length > USER_SEARCH_PAGE_SIZE,
    };
  }
}
