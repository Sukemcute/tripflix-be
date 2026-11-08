import argon2 from 'argon2';
import type { PasswordHasher } from '../application/ports.js';

/** Độ khó của argon2id; bỏ trống là mặc định của thư viện. */
export interface Argon2Cost {
  /** KiB bộ nhớ mỗi lần băm. */
  memoryCost?: number;
  timeCost?: number;
}

/**
 * argon2id, mặc định tham số của thư viện (64 MiB, 3 vòng) như production.
 * Test e2e truyền độ khó thấp: vẫn là argon2 thật nhưng không chiếm CPU khi nhiều test chạy song song.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly cost: Argon2Cost = {}) {}

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.cost });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Hash hỏng hoặc sai định dạng: coi như sai mật khẩu.
      return false;
    }
  }
}
