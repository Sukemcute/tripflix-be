// Kịch bản 1: N người bấm đăng nhập cùng một lúc (mỗi user ảo đăng nhập đúng 1 lần).
//   k6 run -e BASE=https://api.tripflix.io.vn -e PASSWORD=... -e USERS=20 \
//     --summary-export results/login-20.json tools/loadtest/login.js
import http from 'k6/http';
import { check } from 'k6';

const USERS = Number(__ENV.USERS || 20);

export const options = {
  scenarios: {
    spike: { executor: 'per-vu-iterations', vus: USERS, iterations: 1, maxDuration: '3m' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:login}': ['p(95)<5000'],
  },
};

const userEmail = (vu) => `loadtest${String(vu).padStart(4, '0')}@tripflix.local`;

export default function () {
  // Không gửi X-Tripflix-Client: web, nên đi luồng mobile (token trả trong body, không cần chữ ký trình duyệt).
  const res = http.post(
    `${__ENV.BASE}/api/auth/login`,
    JSON.stringify({ email: userEmail(__VU), password: __ENV.PASSWORD, deviceName: 'k6 load test' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' }, timeout: '60s' },
  );
  check(res, {
    'login 200': (r) => r.status === 200,
    'có accessToken': (r) => r.status === 200 && Boolean(r.json('accessToken')),
  });
}
