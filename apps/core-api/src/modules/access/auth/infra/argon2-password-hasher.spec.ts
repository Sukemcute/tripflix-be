import { Argon2PasswordHasher } from './argon2-password-hasher.js';

// Độ khó nhỏ cho nhanh; tỉ lệ cũ/mới giống production (mới nhẹ hơn cũ).
const NEW_COST = { memoryCost: 4096, timeCost: 1 };
const OLD_COST = { memoryCost: 8192, timeCost: 2 };

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher(NEW_COST, OLD_COST);
  const oldHasher = new Argon2PasswordHasher(OLD_COST, OLD_COST);

  it('verify được hash tạo bằng độ khó cũ, và báo cần băm lại', async () => {
    const oldHash = await oldHasher.hash('mat-khau');
    expect(await hasher.verify(oldHash, 'mat-khau')).toBe(true);
    expect(hasher.needsRehash(oldHash)).toBe(true);
  });

  it('hash mới không cần băm lại', async () => {
    expect(hasher.needsRehash(await hasher.hash('mat-khau'))).toBe(false);
  });

  it('hash giả dùng độ khó của hash cũ để thời gian phản hồi không lộ tài khoản', async () => {
    expect(await hasher.hashForTiming('x')).toContain('$m=8192,t=2,');
  });

  it('hash hỏng: verify trả false, không cần băm lại', async () => {
    expect(await hasher.verify('khong-phai-hash', 'x')).toBe(false);
    expect(hasher.needsRehash('khong-phai-hash')).toBe(false);
  });
});
