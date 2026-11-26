// TF99: phần dùng chung cho các kịch bản k6 đo bình luận.
import http from 'k6/http';
import { fail } from 'k6';
import { BENCH_PASSWORD, BENCH_POST_ID, BENCH_USER_COUNT, benchEmail } from '../bench-users.mjs';

export { BENCH_POST_ID };
export const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';
export const API = `${BASE_URL}/api/v1`;
// Đăng ký, đăng nhập không có tiền tố phiên bản.
const AUTH_API = `${BASE_URL}/api/auth`;
export const PAGE_SIZE = 20;
export const TREND_STATS = ['count', 'avg', 'med', 'p(95)', 'p(99)', 'max'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function login(index) {
  const response = http.post(
    `${AUTH_API}/login`,
    JSON.stringify({ email: benchEmail(index), password: BENCH_PASSWORD, deviceName: 'tf99-k6' }),
    { headers: JSON_HEADERS, tags: { name: 'login' } },
  );
  if (response.status !== 200) fail(`Đăng nhập ${benchEmail(index)}: ${response.status} ${response.body}`);
  return response.json('accessToken');
}

/** Token của 5 tài khoản thử, đăng nhập một lần trong setup để lượt đo không lẫn thời gian băm mật khẩu. */
export function loginAll() {
  return Array.from({ length: BENCH_USER_COUNT }, (_, i) => login(i + 1));
}

export function authHeaders(token) {
  return { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } };
}

export function listComments(token, cursor, tags) {
  const query = cursor ? `?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}` : `?limit=${PAGE_SIZE}`;
  return http.get(`${API}/posts/${BENCH_POST_ID}/comments${query}`, { ...authHeaders(token), tags });
}

/**
 * Đi hết các trang bình luận gốc theo nextCursor như web bấm "Xem thêm": ghi cursor của từng trang và đếm bình luận
 * thấy được, để so với total (phát hiện phân trang bỏ sót hay lặp).
 * WALK_MAX_PAGES: chỉ đi tối đa N trang (đo trên server, bình luận dồn lại qua các lượt thì đi hết trang quá lâu);
 * khi đó missing không còn ý nghĩa.
 */
export function walkAllPages(token) {
  const maxPages = Number(__ENV.WALK_MAX_PAGES || 0) || Infinity;
  const cursors = [null];
  const seen = new Set();
  let duplicates = 0;
  let total = 0;
  let cursor = null;
  for (;;) {
    const response = listComments(token, cursor, { name: 'walk' });
    if (response.status !== 200) fail(`Đọc trang ${cursors.length}: ${response.status} ${response.body}`);
    const page = response.json();
    total = page.total;
    for (const item of page.items) {
      if (seen.has(item.id)) duplicates += 1;
      seen.add(item.id);
    }
    if (!page.nextCursor || cursors.length >= maxPages) break;
    cursor = page.nextCursor;
    cursors.push(cursor);
  }
  return { cursors, total, seen: seen.size, duplicates, missing: Math.max(0, total - seen.size) };
}

/** Tóm tắt kết quả: ghi JSON đầy đủ vào out/ và in bảng ngắn ra màn hình. */
export function writeSummary(name, data) {
  const lines = [`\n== ${name} ==`];
  for (const [metric, value] of Object.entries(data.metrics)) {
    if (!metric.startsWith('http_req_duration{') && metric !== 'http_req_failed' && !metric.startsWith('http_req_failed{')) {
      continue;
    }
    const v = value.values;
    const stats = 'p(95)' in v
      ? `p50 ${v.med.toFixed(1)} ms · p95 ${v['p(95)'].toFixed(1)} ms · p99 ${v['p(99)'].toFixed(1)} ms · max ${v.max.toFixed(1)} ms`
      : `tỉ lệ lỗi ${(v.rate * 100).toFixed(2)}%`;
    const verdict = value.thresholds
      ? Object.entries(value.thresholds).map(([rule, r]) => `${r.ok ? 'ĐẠT' : 'TRƯỢT'} ${rule}`).join(', ')
      : '';
    lines.push(`${metric.padEnd(44)} ${stats}${verdict ? `  [${verdict}]` : ''}`);
  }
  if (data.setup_data?.pagination) {
    const p = data.setup_data.pagination;
    lines.push(`phân trang: ${p.pages} trang, total ${p.total}, thấy ${p.seen}, thiếu ${p.missing}, lặp ${p.duplicates}`);
  }
  // OUT_DIR: k6 chạy thẳng (không qua Docker) thì thư mục out/ không nằm ở /bench/out.
  return { [`${__ENV.OUT_DIR || '/bench/out'}/${name}.json`]: JSON.stringify(data, null, 2), stdout: `${lines.join('\n')}\n` };
}
