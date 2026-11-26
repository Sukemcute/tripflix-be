// TF99: tạo dữ liệu đo qua API (dùng khi đo trên server, không có quyền chạy seed.sql):
//   node tools/bench/comments/seed-api.mjs create   bench-1 tạo và đăng 1 bài thử, rồi 5 tài khoản bench đăng 8.000 bình luận gốc
//                                                    và 2.000 trả lời; in BENCH_POST_ID để truyền cho run.sh
//   node tools/bench/comments/seed-api.mjs delete <postId>   bench-1 xoá bài thử qua API (để chỉ mục tìm kiếm nhận sự kiện xoá)
// Biến môi trường: BASE_URL (vd https://api.tripflix.io.vn), BENCH_PASSWORD, BENCH_EMAIL_TEMPLATE (xem bench-users.mjs).
import { BENCH_PASSWORD, BENCH_USER_COUNT, benchEmail } from './bench-users.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ROOT_COMMENTS = Number(process.env.SEED_ROOTS ?? 8000);
const REPLIES = Number(process.env.SEED_REPLIES ?? 2000);
// Chạy từ máy chưa được bỏ rate limit (50 request/s mỗi IP) thì đặt SEED_CONCURRENCY=5.
const CONCURRENCY = Number(process.env.SEED_CONCURRENCY ?? 20);

async function call(method, path, token, body) {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text.slice(0, 200);
  }
  return { status: response.status, body: json };
}

async function login(index) {
  const r = await call('POST', '/auth/login', null, { email: benchEmail(index), password: BENCH_PASSWORD, deviceName: 'tf99-seed' });
  if (r.status !== 200) throw new Error(`Đăng nhập bench ${index}: ${r.status}`);
  return r.body.accessToken ?? r.body.access_token ?? r.body.tokens?.accessToken;
}

/** Chạy jobs với tối đa CONCURRENCY request cùng lúc; in tiến độ mỗi 1.000. */
async function runPool(count, job) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      await job(i);
      done += 1;
      if (done % 1000 === 0) process.stdout.write(`  ${done}/${count}\n`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function create() {
  const tokens = [];
  for (let i = 1; i <= BENCH_USER_COUNT; i += 1) tokens.push(await login(i));
  const draft = await call('POST', '/v1/posts', tokens[0], {
    post_type: 'vlog',
    title: '[BENCH] Bài thử tải bình luận',
    body: 'Bài dùng cho đo tải TF99, sẽ được xoá sau buổi đo.',
    visibility: 'public',
  });
  if (draft.status !== 201) throw new Error(`Tạo bài: ${draft.status} ${JSON.stringify(draft.body)}`);
  const postId = draft.body.id;
  const published = await call('POST', `/v1/posts/${postId}/publish`, tokens[0]);
  if (published.status >= 300) throw new Error(`Đăng bài: ${published.status} ${JSON.stringify(published.body)}`);
  process.stdout.write(`Bài thử: ${postId}\nBình luận gốc:\n`);
  const roots = [];
  let failed = 0;
  await runPool(ROOT_COMMENTS, async (i) => {
    const r = await call('POST', `/v1/posts/${postId}/comments`, tokens[i % tokens.length], { body: `[bench] bình luận nền ${i + 1}: chỗ này đi mùa nào đẹp?` });
    if (r.status === 201) {
      if (roots.length < 1000) roots.push(r.body.id);
    } else failed += 1;
  });
  process.stdout.write('Trả lời:\n');
  await runPool(REPLIES, async (i) => {
    const r = await call('POST', `/v1/posts/${postId}/comments`, tokens[i % tokens.length], {
      body: `[bench] trả lời nền ${i + 1}`,
      parent_comment_id: roots[i % roots.length],
    });
    if (r.status !== 201) failed += 1;
  });
  process.stdout.write(`Xong. Lỗi: ${failed}\nBENCH_POST_ID=${postId}\n`);
}

async function remove(postId) {
  const token = await login(1);
  const r = await call('DELETE', `/v1/posts/${postId}`, token);
  process.stdout.write(`Xoá bài ${postId}: ${r.status}\n`);
}

const [command, arg] = process.argv.slice(2);
if (command === 'create') await create();
else if (command === 'delete' && arg) await remove(arg);
else {
  process.stderr.write('Cách dùng: seed-api.mjs create | delete <postId>\n');
  process.exit(1);
}
