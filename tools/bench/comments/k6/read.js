// TF99 · R1: 50 người cùng đọc trang 1, trang 50 và trang cuối (400) bình luận gốc của bài 10.000 bình luận.
// Ngưỡng: p95 < 150 ms ở mọi trang. setup() còn đi hết các trang để kiểm phân trang không bỏ sót, không lặp.
import { check } from 'k6';
import { listComments, loginAll, TREND_STATS, walkAllPages, writeSummary } from './lib.js';

const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '30s';
const PAGES = ['1', '50', '400'];

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: Object.fromEntries(
    PAGES.map((page, i) => [
      `page${page}`,
      {
        executor: 'constant-vus',
        vus: VUS,
        duration: DURATION,
        startTime: `${i * (parseInt(DURATION, 10) + 5)}s`,
        exec: 'readPage',
        env: { PAGE: page },
        tags: { page },
      },
    ]),
  ),
  thresholds: {
    ...Object.fromEntries(PAGES.map((page) => [`http_req_duration{page:${page}}`, ['p(95)<150']])),
    'http_req_failed{name:read}': ['rate<0.01'],
  },
};

export function setup() {
  const tokens = loginAll();
  const walk = walkAllPages(tokens[0]);
  const lastPage = walk.cursors.length;
  // Trang cuối có thể không đúng 400 nếu dữ liệu khác: lấy trang gần nhất có thật.
  const cursorOf = (page) => walk.cursors[Math.min(Number(page), lastPage) - 1];
  return {
    tokens,
    cursors: Object.fromEntries(PAGES.map((page) => [page, cursorOf(page)])),
    pagination: { pages: lastPage, total: walk.total, seen: walk.seen, missing: walk.missing, duplicates: walk.duplicates },
  };
}

export function readPage(data) {
  const token = data.tokens[__VU % data.tokens.length];
  const response = listComments(token, data.cursors[__ENV.PAGE], { name: 'read' });
  check(response, { 'đọc được trang': (r) => r.status === 200 });
}

export function handleSummary(data) {
  return writeSummary('r1-read', data);
}
