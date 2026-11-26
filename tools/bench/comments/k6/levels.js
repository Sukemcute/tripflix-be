// TF99 · đo theo số người dùng: một lượt k6 là MỘT mức VUS, mỗi VU nghỉ 1–3 s giữa hai thao tác như người thật.
// KIND=read:  đọc bình luận gốc, xen kẽ trang 1, trang 50 và trang cuối.
// KIND=write: gửi bình luận vào cùng một bài, 20% là trả lời.
// KIND=mixed: 80% đọc trang, 15% gửi, 5% mở trả lời của một bình luận.
// Khởi động 10 s (không tính), đo 60 s. Ngưỡng chỉ tính phần đo: đọc p95 < 150 ms, ghi p95 < 300 ms, lỗi < 1%.
// stress.js dùng lại setup, act và teardown của file này, gắn thêm tag phase qua data.extraTags.
// run.sh vus chạy lần lượt VUS=5, 25, 50, 100, 200 cho cả 3 kiểu.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { API, BENCH_POST_ID, authHeaders, listComments, loginAll, PAGE_SIZE, TREND_STATS, walkAllPages, writeSummary } from './lib.js';

const KIND = __ENV.KIND || 'read';
const VUS = Number(__ENV.VUS || 5);
const WARMUP_SECONDS = Number(__ENV.WARMUP_SECONDS || 10);
const MEASURE_SECONDS = Number(__ENV.MEASURE_SECONDS || 60);
const THINK_MIN_SECONDS = 1;
const THINK_MAX_SECONDS = 3;
const REPLY_RATIO = 0.2;
const PAGES = ['1', '50', '400'];
// Tỉ lệ của kiểu mixed: phần còn lại sau đọc trang và gửi là mở trả lời.
const MIXED_READ_SHARE = 0.8;
const MIXED_WRITE_SHARE = 0.15;

// Sau lượt có ghi, đi lại hết các trang: bình luận mới chen vào không được làm phân trang thiếu hay lặp.
const pagingMissing = new Counter('paging_missing');
const pagingDuplicates = new Counter('paging_duplicates');

if (!['read', 'write', 'mixed'].includes(KIND)) fail(`KIND phải là read, write hoặc mixed, nhận ${KIND}`);

const vuStep = (step) => ({ executor: 'constant-vus', vus: VUS, exec: 'act', tags: { step } });

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    warmup: { ...vuStep('warmup'), duration: `${WARMUP_SECONDS}s` },
    measure: { ...vuStep('measure'), duration: `${MEASURE_SECONDS}s`, startTime: `${WARMUP_SECONDS}s` },
  },
  thresholds: {
    // Ngưỡng luôn đạt, chỉ để k6 tách số liệu của phần đo: chờ kết nối (blocked, connecting) và chờ phản hồi (waiting).
    'http_req_duration{step:measure}': ['max>=0'],
    'http_req_blocked{step:measure}': ['max>=0'],
    'http_req_connecting{step:measure}': ['max>=0'],
    'http_req_waiting{step:measure}': ['max>=0'],
    'iterations{step:measure}': ['count>=0'],
    'http_req_duration{step:measure,name:read}': ['p(95)<150'],
    'http_req_duration{step:measure,name:replies}': ['p(95)<150'],
    'http_req_duration{step:measure,name:write}': ['p(95)<300'],
    'http_req_failed{step:measure}': ['rate<0.01'],
    paging_missing: ['count==0'],
    paging_duplicates: ['count==0'],
  },
};

export function setup() {
  const tokens = loginAll();
  const walk = walkAllPages(tokens[0]);
  const lastPage = walk.cursors.length;
  const firstPage = listComments(tokens[0], null, { name: 'setup' }).json('items');
  // Bình luận gốc có trả lời (seed rải 2.000 trả lời vào 1.000 bình luận gốc), để kiểu mixed mở trả lời có dữ liệu.
  const threadIds = findThreadIds(tokens[0], walk.cursors);
  // Mốc giờ (ms) để ghép với mẫu CPU, pool, Postgres: phần đo bắt đầu sau setup + khởi động.
  const setupEndedAt = Date.now();
  return {
    setupEndedAt,
    measureStartAt: setupEndedAt + WARMUP_SECONDS * 1000,
    measureEndAt: setupEndedAt + (WARMUP_SECONDS + MEASURE_SECONDS) * 1000,
    tokens,
    cursors: PAGES.map((page) => walk.cursors[Math.min(Number(page), lastPage) - 1]),
    parentIds: firstPage.map((comment) => comment.id),
    threadIds,
    kind: KIND,
    vus: VUS,
    steps: { measure: MEASURE_SECONDS },
    pagination: { pages: lastPage, total: walk.total, seen: walk.seen, missing: walk.missing, duplicates: walk.duplicates },
  };
}

function findThreadIds(token, cursors) {
  const ids = [];
  for (const cursor of cursors.slice(0, 20)) {
    const items = listComments(token, cursor, { name: 'setup' }).json('items') ?? [];
    for (const item of items) if ((item.replyCount ?? 0) > 0) ids.push(item.id);
    if (ids.length >= 50) break;
  }
  return ids;
}

function readPage(data, token) {
  const index = Math.floor(Math.random() * PAGES.length);
  const response = listComments(token, data.cursors[index], { name: 'read', page: PAGES[index], ...data.extraTags });
  check(response, { 'đọc được trang': (r) => r.status === 200 });
}

function readReplies(data, token) {
  if (data.threadIds.length === 0) return readPage(data, token);
  const parentId = data.threadIds[Math.floor(Math.random() * data.threadIds.length)];
  const response = http.get(
    `${API}/posts/${BENCH_POST_ID}/comments?limit=${PAGE_SIZE}&parent_comment_id=${parentId}`,
    { ...authHeaders(token), tags: { name: 'replies', ...data.extraTags } },
  );
  check(response, { 'đọc được trả lời': (r) => r.status === 200 });
}

function sendComment(data, token) {
  const isReply = Math.random() < REPLY_RATIO && data.parentIds.length > 0;
  const body = {
    body: `[bench] k6 ${KIND} ${VUS} VU, VU ${__VU} lượt ${__ITER}: chỗ này đi mùa nào đẹp?`,
    ...(isReply ? { parent_comment_id: data.parentIds[__ITER % data.parentIds.length] } : {}),
  };
  const params = authHeaders(token);
  params.tags = { name: 'write', ...data.extraTags };
  const response = http.post(`${API}/posts/${BENCH_POST_ID}/comments`, JSON.stringify(body), params);
  check(response, { 'gửi được bình luận': (r) => r.status === 201 });
}

export function act(data) {
  const token = data.tokens[__VU % data.tokens.length];
  if (KIND === 'read') readPage(data, token);
  else if (KIND === 'write') sendComment(data, token);
  else {
    const roll = Math.random();
    if (roll < MIXED_READ_SHARE) readPage(data, token);
    else if (roll < MIXED_READ_SHARE + MIXED_WRITE_SHARE) sendComment(data, token);
    else readReplies(data, token);
  }
  sleep(THINK_MIN_SECONDS + Math.random() * (THINK_MAX_SECONDS - THINK_MIN_SECONDS));
}

export function teardown(data) {
  // SKIP_PAGING=1 khi đo trên server: bình luận dồn qua các lượt, đi hết trang mất vài phút mỗi lượt.
  if (KIND === 'read' || __ENV.SKIP_PAGING === '1') return;
  const walk = walkAllPages(data.tokens[0]);
  pagingMissing.add(walk.missing);
  pagingDuplicates.add(walk.duplicates);
}

export function handleSummary(data) {
  return writeSummary(`v-${KIND}-${VUS}`, data);
}
