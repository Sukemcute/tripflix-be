import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_STORE, type AccessStore } from './auth/application/ports.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cửa duy nhất để module khác đọc dữ liệu access, gọi trong tiến trình (docs/11 §3.2). Chỉ đọc.
 * Module khác inject class này qua AccessModule, không đọc bảng của access.
 */
@Injectable()
export class AccessFacade {
  constructor(@Inject(ACCESS_STORE) private readonly store: AccessStore) {}

  /** Tên hiển thị công khai theo id người dùng. Id không hợp lệ hoặc không tồn tại thì không có trong Map. */
  async getDisplayNames(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) return new Map();
    const users = await this.store.users.findByIds(ids);
    return new Map(users.map((u) => [u.id, u.displayName]));
  }
}
