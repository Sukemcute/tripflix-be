import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_STORE, type AccessStore } from '../../auth/application/ports.js';
import { toPublicUser, type PublicUser } from '../../auth/application/public-user.js';

/** Việc của trang quản trị. Cấp quyền, khoá tài khoản làm ở task sau. */
@Injectable()
export class StaffUseCases {
  constructor(@Inject(ACCESS_STORE) private readonly store: AccessStore) {}

  async listStaff(): Promise<PublicUser[]> {
    return (await this.store.users.listStaff()).map(toPublicUser);
  }
}
