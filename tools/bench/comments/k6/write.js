// TF99 · W1: nhiều người cùng gửi bình luận vào MỘT bài (dòng bài bị khoá FOR UPDATE trong mỗi lượt thêm).
// MODE=load (mặc định): 50, 100, 200 người gửi liên tục, mỗi mức 30 s. Ngưỡng p95 < 300 ms ở mức 100.
// MODE=stress: giữ tốc độ gửi 50 → 100 → 200 → 400 → 800 request/giây, mỗi bậc 30 s, tìm điểm vỡ.
// MODE=spike: 10 request/giây, vọt lên 500 trong 20 s (bài viral), rồi về 10.
// MODE=soak: 20 request/giây trong SOAK_MINUTES phút (mặc định 30), tìm rò rỉ và tồn đọng outbox.
// MODE=sweep: 1, 2, 5, 10, 25 người gửi liên tục, mỗi mức 15 s: vẽ đường sức ghi (dừng tăng sớm = ghi bị tuần tự hoá).
// stress, spike, soak giữ tốc độ gửi cố định (arrival rate): server chậm thì request vẫn tới, không tự giảm tải.
import http from 'k6/http';
import { check } from 'k6';
import { API, BENCH_POST_ID, authHeaders, listComments, login, loginAll, TREND_STATS, writeSummary } from './lib.js';

const MODE = __ENV.MODE || 'load';
const SOAK_MINUTES = Number(__ENV.SOAK_MINUTES || 30);
const REPLY_RATIO = 0.2;
// Token sống 15 phút: chạy lâu hơn thì mỗi VU tự đăng nhập lại.
const RELOGIN_AFTER_MS = 10 * 60 * 1000;

function rateStep(name, rate, startSeconds, durationSeconds, maxVUs) {
  return {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: `${durationSeconds}s`,
    startTime: `${startSeconds}s`,
    preAllocatedVUs: Math.min(maxVUs, Math.max(20, rate)),
    maxVUs,
    exec: 'sendComment',
    tags: { step: name },
  };
}

function buildScenarios() {
  if (MODE === 'stress') {
    return Object.fromEntries(
      [50, 100, 200, 400, 800].map((rate, i) => [`rps${rate}`, rateStep(`rps${rate}`, rate, i * 35, 30, 1000)]),
    );
  }
  if (MODE === 'spike') {
    return {
      before: rateStep('before', 10, 0, 30, 50),
      spike: rateStep('spike', 500, 30, 20, 1000),
      after: rateStep('after', 10, 50, 40, 50),
    };
  }
  if (MODE === 'soak') {
    return { soak: rateStep('soak', 20, 0, SOAK_MINUTES * 60, 200) };
  }
  if (MODE === 'sweep') {
    return Object.fromEntries(
      [1, 2, 5, 10, 25].map((vus, i) => [
        `vus${vus}`,
        { executor: 'constant-vus', vus, duration: '15s', startTime: `${i * 20}s`, exec: 'sendComment', tags: { step: `vus${vus}` } },
      ]),
    );
  }
  return Object.fromEntries(
    [50, 100, 200].map((vus, i) => [
      `vus${vus}`,
      { executor: 'constant-vus', vus, duration: '30s', startTime: `${i * 35}s`, exec: 'sendComment', tags: { step: `vus${vus}` } },
    ]),
  );
}

const scenarios = buildScenarios();

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios,
  thresholds: {
    ...Object.fromEntries(Object.keys(scenarios).map((step) => [`http_req_duration{step:${step}}`, ['p(95)<300']])),
    // Ngưỡng luôn đạt, chỉ để k6 tách số lượt bị bỏ (k6 không kịp gửi vì hết VU) theo từng bậc.
    ...Object.fromEntries(Object.keys(scenarios).map((step) => [`dropped_iterations{step:${step}}`, ['count>=0']])),
    'http_req_failed{name:write}': ['rate<0.01'],
  },
};

export function setup() {
  const tokens = loginAll();
  const firstPage = listComments(tokens[0], null, { name: 'setup' }).json('items');
  return {
    tokens,
    parentIds: firstPage.map((comment) => comment.id),
    startedAt: Date.now(),
    // Thời lượng từng bậc (giây) để summarize.mjs tính số request/giây thật.
    steps: Object.fromEntries(Object.entries(scenarios).map(([step, scenario]) => [step, parseInt(scenario.duration, 10)])),
  };
}

let ownToken = null;
let ownTokenAt = 0;

function tokenFor(data) {
  if (Date.now() - data.startedAt < RELOGIN_AFTER_MS) return data.tokens[__VU % data.tokens.length];
  if (!ownToken || Date.now() - ownTokenAt > RELOGIN_AFTER_MS) {
    ownToken = login((__VU % data.tokens.length) + 1);
    ownTokenAt = Date.now();
  }
  return ownToken;
}

export function sendComment(data) {
  const isReply = Math.random() < REPLY_RATIO && data.parentIds.length > 0;
  const body = {
    body: `[bench] k6 ${MODE} VU ${__VU} lượt ${__ITER}: chỗ này đi mùa nào đẹp?`,
    ...(isReply ? { parent_comment_id: data.parentIds[__ITER % data.parentIds.length] } : {}),
  };
  const params = authHeaders(tokenFor(data));
  params.tags = { name: 'write' };
  const response = http.post(`${API}/posts/${BENCH_POST_ID}/comments`, JSON.stringify(body), params);
  check(response, { 'gửi được bình luận': (r) => r.status === 201 });
}

export function handleSummary(data) {
  return writeSummary(`w1-${MODE}`, data);
}
