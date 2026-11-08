import { Argon2PasswordHasher } from './argon2-password-hasher.js';

/**
 * Hàm băm cho test e2e: argon2id thật với độ khó thấp (4 MiB, 1 vòng).
 * Tham số production (64 MiB, 3 vòng) làm test đăng nhập nhiều lần vượt giới hạn 5 giây khi cả bộ test chạy song song.
 */
export const createTestPasswordHasher = () => new Argon2PasswordHasher({ memoryCost: 4096, timeCost: 1 });
