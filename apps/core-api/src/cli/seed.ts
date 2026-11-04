import '../platform/load-env.js';
import { loadEnv } from '@tripflix/config';
import type { Role } from '@tripflix/contracts';
import { createDb, createPool } from '@tripflix/db';
import { z } from 'zod';
import { Argon2PasswordHasher } from '../modules/access/auth/infra/argon2-password-hasher.js';
import { DrizzleAccessStore } from '../modules/access/auth/infra/drizzle-access.store.js';
import { seedCatalog } from '../modules/commerce/db/seed/seed-catalog.js';
import { CalendarUseCases } from '../modules/commerce/inventory/application/calendar.use-cases.js';
import { DrizzleCommerceStore } from '../modules/commerce/inventory/infra/drizzle-commerce.store.js';
import { coreEnvSchema } from '../platform/env.js';

// pnpm db:seed: tạo tài khoản mẫu cho 3 vai trò. Chạy lại nhiều lần không tạo trùng. Không chạy ở production.
const env = loadEnv(
  coreEnvSchema.and(z.object({ SEED_PASSWORD: z.string().min(8, 'cần ít nhất 8 ký tự') })),
);
if (env.NODE_ENV === 'production') {
  process.stderr.write('Không seed tài khoản mẫu ở production\n');
  process.exit(1);
}

const ACCOUNTS: { email: string; displayName: string; role: Role }[] = [
  { email: 'superadmin@tripflix.local', displayName: 'Quản trị viên', role: 'superadmin' },
  { email: 'moderator@tripflix.local', displayName: 'Kiểm duyệt viên', role: 'moderator' },
  { email: 'member@tripflix.local', displayName: 'Thành viên mẫu', role: 'member' },
];

const pool = createPool({ url: env.DATABASE_URL_ACCESS, max: 1, applicationName: 'seed:access' });
try {
  const store = new DrizzleAccessStore(createDb(pool));
  const passwordHash = await new Argon2PasswordHasher().hash(env.SEED_PASSWORD);
  for (const account of ACCOUNTS) {
    const created = await store.users.insert({ ...account, passwordHash });
    process.stdout.write(`${account.email} (${account.role}): ${created ? 'đã tạo' : 'đã có, giữ nguyên'}\n`);
  }
} finally {
  await pool.end();
}

// Commerce: danh mục khách sạn, chuyến bay giả lập rồi mở lịch trống 180 ngày tới. Chạy lại không tạo trùng.
const commercePool = createPool({ url: env.DATABASE_URL_COMMERCE, max: 1, applicationName: 'seed:commerce' });
try {
  const commerceDb = createDb(commercePool);
  const catalog = await seedCatalog(commerceDb);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const opened = await new CalendarUseCases(new DrizzleCommerceStore(commerceDb), () => today).openCalendarWindow();
  process.stdout.write(
    `commerce: ${catalog.hotels} khách sạn, ${catalog.roomTypes} loại phòng, ${catalog.flights} hạng ghế; ` +
      `mở thêm ${opened.roomDays} ngày phòng, ${opened.flightDays} ngày bay\n`,
  );
} finally {
  await commercePool.end();
}
