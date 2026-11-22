// Kịch bản 3: N kết nối WebSocket (Socket.IO) giữ mở cùng lúc vào notification-service.
//   cd tools/loadtest && npm install
//   BASE=https://api.tripflix.io.vn PASSWORD=... USERS=20 RAMP_S=60 HOLD_S=300 node ws.mjs
// In kết quả JSON ra màn hình và ghi vào results/ws-<USERS>-<giờ>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const BASE = process.env.BASE;
const PASSWORD = process.env.PASSWORD;
const USERS = Number(process.env.USERS || 20);
const RAMP_S = Number(process.env.RAMP_S || 60);
const HOLD_S = Number(process.env.HOLD_S || 300);
if (!BASE || !PASSWORD) throw new Error('Cần BASE và PASSWORD');

const email = (n) => `loadtest${String(n).padStart(4, '0')}@tripflix.local`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

async function login(n) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email(n), password: PASSWORD, deviceName: 'ws load test' }),
  });
  if (!res.ok) throw new Error(`login ${email(n)}: HTTP ${res.status}`);
  return (await res.json()).accessToken;
}

// Bước 1: lấy token trước (10 người một lượt) để lúc đo chỉ còn WebSocket.
const tokens = [];
for (let start = 1; start <= USERS; start += 10) {
  const batch = Array.from({ length: Math.min(10, USERS - start + 1) }, (_, i) => login(start + i));
  tokens.push(...(await Promise.all(batch)));
}

const stats = { connected: 0, connectMs: [], connectErrors: {}, disconnects: {}, authExpired: 0, notifications: 0 };
const sockets = [];

function open(token) {
  const startedAt = Date.now();
  const socket = io(BASE, { path: '/ws', transports: ['websocket'], auth: { token }, reconnection: false, timeout: 20_000 });
  socket.on('connect', () => {
    stats.connected += 1;
    stats.connectMs.push(Date.now() - startedAt);
  });
  socket.on('connect_error', (err) => {
    stats.connectErrors[err.message] = (stats.connectErrors[err.message] ?? 0) + 1;
  });
  socket.on('disconnect', (reason) => {
    stats.disconnects[reason] = (stats.disconnects[reason] ?? 0) + 1;
  });
  socket.on('auth.expired', () => (stats.authExpired += 1));
  socket.on('notification.created', () => (stats.notifications += 1));
  sockets.push(socket);
}

// Bước 2: mở dần N kết nối trong RAMP_S giây, rồi giữ HOLD_S giây.
const gapMs = (RAMP_S * 1000) / USERS;
for (const token of tokens) {
  open(token);
  await sleep(gapMs);
}
await sleep(HOLD_S * 1000);

const stillOpen = sockets.filter((s) => s.connected).length;
for (const socket of sockets) socket.close();

const summary = {
  users: USERS,
  rampSeconds: RAMP_S,
  holdSeconds: HOLD_S,
  connected: stats.connected,
  stillOpenAtEnd: stillOpen,
  connectMs: { p50: percentile(stats.connectMs, 50), p95: percentile(stats.connectMs, 95), max: percentile(stats.connectMs, 100) },
  connectErrors: stats.connectErrors,
  disconnects: stats.disconnects,
  authExpired: stats.authExpired,
  notificationsReceived: stats.notifications,
};
const json = JSON.stringify(summary, null, 2);
process.stdout.write(`${json}\n`);
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/ws-${USERS}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url), json);
process.exit(0);
