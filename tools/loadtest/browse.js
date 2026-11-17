// Kịch bản 2: N người đang dùng app (đăng nhập 1 lần, rồi lướt feed, xem bài, thả cảm xúc, xem thông báo).
//   k6 run -e BASE=https://api.tripflix.io.vn -e PASSWORD=... -e USERS=20 \
//     --summary-export results/browse-20.json tools/loadtest/browse.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const USERS = Number(__ENV.USERS || 20);
const HOLD = __ENV.HOLD || '5m';

// Chỉ thả cảm xúc lên 10 bài seed (tác giả là tài khoản mẫu), để không gửi thông báo rác cho người dùng thật.
const SEED_POST_IDS = Array.from({ length: 10 }, (_, i) => `018d9f20-0000-7000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
// Access token sống 15 phút: refresh sớm trước khi hết hạn.
const REFRESH_AFTER_MS = 12 * 60 * 1000;

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: USERS },
        { duration: HOLD, target: USERS },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:feed}': ['p(95)<1000'],
    'http_req_duration{name:post}': ['p(95)<1000'],
    'http_req_duration{name:reaction}': ['p(95)<1000'],
    'http_req_duration{name:inbox}': ['p(95)<1000'],
  },
};

const json = { 'Content-Type': 'application/json' };
// Biến cấp module: mỗi user ảo có bản riêng, giữ qua các vòng lặp.
let session = null;

function login() {
  const email = `loadtest${String(__VU).padStart(4, '0')}@tripflix.local`;
  const res = http.post(`${__ENV.BASE}/api/auth/login`, JSON.stringify({ email, password: __ENV.PASSWORD, deviceName: 'k6 load test' }), {
    headers: json,
    tags: { name: 'login' },
    timeout: '60s',
  });
  if (!check(res, { 'login 200': (r) => r.status === 200 })) return null;
  return { access: res.json('accessToken'), refresh: res.json('refreshToken'), at: Date.now() };
}

function refresh() {
  const res = http.post(`${__ENV.BASE}/api/auth/refresh`, JSON.stringify({ refreshToken: session.refresh }), { headers: json, tags: { name: 'refresh' } });
  if (check(res, { 'refresh 200': (r) => r.status === 200 })) {
    session = { access: res.json('accessToken'), refresh: res.json('refreshToken'), at: Date.now() };
  } else {
    session = null;
  }
}

const auth = (name) => ({ headers: { ...json, Authorization: `Bearer ${session.access}` }, tags: { name } });
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default function () {
  if (!session) session = login();
  if (!session) return sleep(5);
  if (Date.now() - session.at > REFRESH_AFTER_MS) refresh();
  if (!session) return;

  const roll = Math.random();
  if (roll < 0.6) {
    const res = http.get(`${__ENV.BASE}/api/v1/feed?limit=10`, auth('feed'));
    check(res, { 'feed 200': (r) => r.status === 200 });
  } else if (roll < 0.8) {
    const postId = pick(SEED_POST_IDS);
    check(http.get(`${__ENV.BASE}/api/v1/posts/${postId}`, auth('post')), { 'post 200': (r) => r.status === 200 });
    check(http.get(`${__ENV.BASE}/api/v1/posts/${postId}/comments`, auth('comments')), { 'comments 200': (r) => r.status === 200 });
  } else if (roll < 0.9) {
    // Thả rồi bỏ cảm xúc: sinh thông báo thật nhưng không để lại dữ liệu.
    const url = `${__ENV.BASE}/api/v1/posts/${pick(SEED_POST_IDS)}/reaction`;
    check(http.put(url, JSON.stringify({ type: pick(['like', 'love', 'helpful']) }), auth('reaction')), { 'reaction 200': (r) => r.status === 200 });
    sleep(1);
    check(http.put(url, JSON.stringify({ type: null }), auth('reaction')), { 'unreact 200': (r) => r.status === 200 });
  } else {
    check(http.get(`${__ENV.BASE}/notifications?limit=20`, auth('inbox')), { 'inbox 200': (r) => r.status === 200 });
    check(http.get(`${__ENV.BASE}/notifications/unread-count`, auth('inbox')), { 'unread 200': (r) => r.status === 200 });
  }
  // Người thật nghỉ 3–5 giây giữa hai thao tác.
  sleep(3 + Math.random() * 2);
}
