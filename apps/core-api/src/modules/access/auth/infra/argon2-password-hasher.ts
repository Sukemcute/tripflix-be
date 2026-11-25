import argon2 from 'argon2';
import type { PasswordHasher } from '../application/ports.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';

/** Độ khó của argon2id. */
export interface Argon2Cost {
  /** KiB bộ nhớ mỗi lần băm. */
  memoryCost: number;
  timeCost: number;
}

/**
 * Mức OWASP cho argon2id (19 MiB, 2 vòng): nhẹ hơn mặc định thư viện khoảng 5 lần,
 * để 4 vCPU chịu được nhiều người đăng nhập cùng lúc (load test 16/11: chờ ~57 giây ở 200 người).
 */
export const ARGON2_COST: Argon2Cost = { memoryCost: 19_456, timeCost: 2 };

/** Mức cũ (mặc định thư viện: 64 MiB, 3 vòng) mà hash tạo trước khi đổi đang dùng. */
export const ARGON2_LEGACY_COST: Argon2Cost = { memoryCost: 65_536, timeCost: 3 };

/** 4 vCPU, libuv mặc định 4 luồng: chừa 1 luồng cho DNS, file và crypto khác. */
const MAX_ACTIVE_HASHES = 3;
/** Quá số này thì người đứng cuối hàng chờ vài giây vẫn chưa tới lượt: báo bận ngay. */
const MAX_WAITING_HASHES = 50;

/**
 * argon2id. Hash lưu sẵn tham số của nó nên verify được cả hash cũ; needsRehash báo hash nào cần băm lại theo mức mới.
 * Test e2e truyền độ khó thấp: vẫn là argon2 thật nhưng không chiếm CPU khi nhiều test chạy song song.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  constructor(
    private readonly cost: Argon2Cost = ARGON2_COST,
    /** Độ khó của hash giả, phải bằng mức của đa số hash đang lưu thì thời gian phản hồi mới không lộ tài khoản. */
    private readonly timingCost: Argon2Cost = ARGON2_LEGACY_COST,
    private readonly limiter = new ConcurrencyLimiter(MAX_ACTIVE_HASHES, MAX_WAITING_HASHES),
  ) {}

  hash(password: string): Promise<string> {
    return this.limiter.run(() => argon2.hash(password, { type: argon2.argon2id, ...this.cost }));
  }

  // Không qua limiter: chỉ chạy một lần mỗi tiến trình và được cache, lỗi "bận" sẽ bị cache theo.
  // shortcut: hash giả còn theo mức cũ, đổi sang ARGON2_COST khi đa số tài khoản đã đăng nhập lại và được băm lại.
  hashForTiming(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.timingCost });
  }

  // Lỗi "bận" của limiter đi ra ngoài (503), không bị nuốt thành sai mật khẩu.
  verify(hash: string, password: string): Promise<boolean> {
    return this.limiter.run(async () => {
      try {
        return await argon2.verify(hash, password);
      } catch {
        // Hash hỏng hoặc sai định dạng: coi như sai mật khẩu.
        return false;
      }
    });
  }

  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.cost);
    } catch {
      return false;
    }
  }
}
