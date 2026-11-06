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

export function mapPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Hồ sơ của chính người đang đăng nhập (GET/PATCH /auth/me): thêm thông tin cá nhân, không dùng cho danh sách nhân viên. */
export interface MyProfile extends PublicUser {
  phone: string | null;
  dateOfBirth: string | null;
  gender: UserRecord['personal']['gender'];
  nationality: string | null;
}

export function mapMyProfile(user: UserRecord): MyProfile {
  return { ...mapPublicUser(user), ...user.personal };
}
