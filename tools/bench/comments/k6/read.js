// TF99 · R1: đọc bình luận gốc của bài 10.000 bình luận, xen kẽ trang 1, trang 50 và trang cuối (400).
// READ_MODE=rate (mặc định): giữ 25 → 50 → 100 → 150 → 200 request/giây, mỗi bậc 20 s. Ngưỡng p95 < 150 ms ở mỗi bậc:
//   bậc cao nhất còn ĐẠT là sức đọc của máy đo. Tốc độ gửi cố định nên server chậm thì request vẫn tới (không giấu hàng chờ).
// READ_MODE=sweep: 1, 5, 10, 25, 50 người đọc liên tục không nghỉ, mỗi mức 15 s: vẽ đường sức chứa (request/giây, độ trễ).
// setup() còn đi hết các trang để kiểm phân trang không bỏ sót, không lặp.
import { check } from 'k6';
import { listComments, loginAll, TREND_STATS, walkAllPages, writeSummary } from './lib.js';

const READ_MODE = __ENV.READ_MODE || 'rate';
const PAGES = ['1', '50', '400'];
const GAP_SECONDS = 5;

function buildSteps() {
  if (READ_MODE === 'sweep') {
    return [1, 5, 10, 25, 50].map((vus) => ({
      name: `vus${vus}`,
      seconds: 15,
      scenario: { executor: 'constant-vus', vus },
    }));
  }
  return [25, 50, 100, 150, 200].map((rate) => ({
    name: `rps${rate}`,
    seconds: 20,
    scenario: { executor: 'constant-arrival-rate', rate, timeUnit: '1s', preAllocatedVUs: rate, maxVUs: rate * 4 },
  }));
}

const steps = buildSteps();

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: Object.fromEntries(
    steps.map((step, i) => [
      step.name,
      {
        ...step.scenario,
        duration: `${step.seconds}s`,
        startTime: `${steps.slice(0, i).reduce((sum, s) => sum + s.seconds + GAP_SECONDS, 0)}s`,
        exec: 'readPage',
        tags: { step: step.name },
      },
    ]),
  ),
  thresholds: {
    ...Object.fromEntries(steps.map((step) => [`http_req_duration{step:${step.name}}`, ['p(95)<150']])),
    // Ngưỡng luôn đạt, chỉ để k6 tách số lượt bị bỏ (k6 không kịp gửi vì hết VU) theo từng bậc.
    ...Object.fromEntries(steps.map((step) => [`dropped_iterations{step:${step.name}}`, ['count>=0']])),
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
    cursors: PAGES.map(cursorOf),
    steps: Object.fromEntries(steps.map((step) => [step.name, step.seconds])),
    pagination: { pages: lastPage, total: walk.total, seen: walk.seen, missing: walk.missing, duplicates: walk.duplicates },
  };
}

export function readPage(data) {
  const token = data.tokens[__VU % data.tokens.length];
  const pageIndex = (__VU + __ITER) % PAGES.length;
  const response = listComments(token, data.cursors[pageIndex], { name: 'read', page: PAGES[pageIndex] });
  check(response, { 'đọc được trang': (r) => r.status === 200 });
}

export function handleSummary(data) {
  // run.sh truyền SUMMARY_NAME: cùng chế độ sweep nhưng paging cần tên riêng (r1-paging).
  return writeSummary(__ENV.SUMMARY_NAME || (READ_MODE === 'sweep' ? 'r1-sweep' : 'r1-read'), data);
}
