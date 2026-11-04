import type { Role } from '@tripflix/contracts';
import type { UserRecord } from './ports.js';

/** Phần thông tin người dùng được trả ra API; không bao giờ có password_hash. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
