import argon2 from 'argon2';
import type { PasswordHasher } from '../application/ports.js';

/** argon2id với tham số mặc định của thư viện (64 MiB, 3 vòng). */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
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
