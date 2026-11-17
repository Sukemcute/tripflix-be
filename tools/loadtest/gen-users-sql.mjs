// Sinh users.sql tạo N tài khoản loadtestNNNN@tripflix.local (đuôi .local: không gửi được email thật).
// Chạy trên laptop trong repo (dùng argon2 của core-api):
//   LOADTEST_PASSWORD=... node tools/loadtest/gen-users-sql.mjs 1000 > users.sql
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/core-api/package.json', import.meta.url));
const argon2 = require('argon2');

const count = Number(process.argv[2] ?? 1000);
const password = process.env.LOADTEST_PASSWORD;
if (!password || password.length < 8) throw new Error('Cần LOADTEST_PASSWORD (ít nhất 8 ký tự)');
if (!Number.isInteger(count) || count < 1 || count > 9999) throw new Error('Số tài khoản phải từ 1 đến 9999');

// Cùng tham số mặc định như production (64 MiB, 3 vòng), để đo đúng chi phí đăng nhập thật.
const hash = await argon2.hash(password, { type: argon2.argon2id });

process.stdout.write(`-- ${count} tài khoản load test. Chạy lại không tạo trùng.
INSERT INTO access.users (email, password_hash, display_name, email_verified_at)
SELECT format('loadtest%s@tripflix.local', lpad(i::text, 4, '0')), '${hash}', 'Load test ' || i, now()
FROM generate_series(1, ${count}) AS i
ON CONFLICT (email) DO NOTHING;
SELECT count(*) AS loadtest_users FROM access.users WHERE email LIKE 'loadtest%@tripflix.local';
`);
