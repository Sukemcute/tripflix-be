// TF99: tạo 5 tài khoản thử bench-1..5@tripflix.local qua đúng luồng đăng ký thật, chỉ dùng thư viện có sẵn của Node.
// Mã xác thực email đọc từ Mailpit, nên lúc chạy cần core-api, notification-service và Mailpit.
// Tài khoản đã có thì chỉ thử đăng nhập. Chạy một lần cho mỗi DB; k6 tự đăng nhập lại mỗi lần đo.
//   node tools/bench/comments/setup-users.mjs
// Biến môi trường: BASE_URL (mặc định http://localhost:3000), MAILPIT_URL (mặc định http://localhost:8025).
import { BENCH_PASSWORD, BENCH_USER_COUNT, benchEmail } from './bench-users.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const CODE_WAIT_MS = 30_000;

async function postJson(path, body) {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function canLogin(email) {
  const { status } = await postJson('/auth/login', { email, password: BENCH_PASSWORD, deviceName: 'tf99-bench' });
  return status === 200;
}

/** Mã 8 số trong thư mới nhất gửi tới email, nhận sau thời điểm sentAfter. */
async function waitForCode(email, sentAfter) {
  const deadline = Date.now() + CODE_WAIT_MS;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=1`);
    const { messages = [] } = await search.json();
    const latest = messages[0];
    if (latest && new Date(latest.Created).getTime() >= sentAfter) {
      const message = await (await fetch(`${MAILPIT_URL}/api/v1/message/${latest.ID}`)).json();
      const code = /\b(\d{8})\b/.exec(`${message.Subject} ${message.Text}`)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Không thấy mã xác thực của ${email} trong Mailpit sau ${CODE_WAIT_MS / 1000}s: notification-service có đang chạy không?`);
}

async function register(email, index) {
  const sentAfter = Date.now() - 2000;
  const requested = await postJson('/auth/registration-code', { email });
  if (requested.status !== 202) throw new Error(`Xin mã cho ${email}: ${requested.status} ${JSON.stringify(requested.body)}`);
  const code = await waitForCode(email, sentAfter);
  const registered = await postJson('/auth/register', {
    email,
    password: BENCH_PASSWORD,
    displayName: `Bench ${index}`,
    registrationId: requested.body.registrationId,
    code,
    dateOfBirth: '1995-01-01',
    gender: 'other',
    nationality: 'VN',
    acceptTerms: true,
  });
  if (registered.status !== 201) throw new Error(`Đăng ký ${email}: ${registered.status} ${JSON.stringify(registered.body)}`);
}

for (let index = 1; index <= BENCH_USER_COUNT; index += 1) {
  const email = benchEmail(index);
  if (await canLogin(email)) {
    process.stdout.write(`${email}: đã có\n`);
    continue;
  }
  await register(email, index);
  if (!(await canLogin(email))) throw new Error(`${email}: đăng ký xong nhưng không đăng nhập được`);
  process.stdout.write(`${email}: đã tạo\n`);
}
