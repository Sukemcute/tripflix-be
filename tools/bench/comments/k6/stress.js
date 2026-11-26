// TF99 · stress test theo số người dùng, kịch bản hỗn hợp (80% đọc, 15% gửi, 5% mở trả lời), mỗi VU nghỉ 1–3 s.
// SHAPE=stress: tăng đều 0 → 1500 VU trong 10 phút, giữ 2 phút, hạ về 50 VU trong 30 s, theo dõi hồi phục 3 phút.
// SHAPE=spike:  giữ 50 VU 1 phút, nhảy lên 1000 VU trong 10 s, giữ 1 phút, rơi về 50 VU trong 10 s, theo dõi 3 phút.
// Mỗi request gắn tag phase theo thời điểm gửi (ramp01..ramp10 là từng phút của đoạn tăng, mỗi phút thêm 150 VU),
// để bản tóm tắt có p95 và tỉ lệ lỗi phía client cho từng đoạn. Diễn biến từng giây lấy từ đầu đo trong core-api (probe.mjs).
import { fail } from 'k6';
import { act as actLevels, setup as setupLevels, teardown as teardownLevels } from './levels.js';
import { TREND_STATS, writeSummary } from './lib.js';

const SHAPE = __ENV.SHAPE || 'stress';

// Mỗi đoạn: [tên, giây, VU ở cuối đoạn]. VU giữa đoạn tăng/giảm tuyến tính như ramping-vus của k6.
const SHAPES = {
  stress: [
    ...Array.from({ length: 10 }, (_, i) => [`ramp${String(i + 1).padStart(2, '0')}`, 60, 150 * (i + 1)]),
    ['hold', 120, 1500],
    ['down', 30, 50],
    ['rec1', 30, 50],
    ['rec2', 150, 50],
  ],
  // Bản nhỏ cho server (staging 4 vCPU): 0 → 800 VU trong 8 phút, giữ 1 phút, hạ về 50, theo dõi 2 phút.
  stress800: [
    ...Array.from({ length: 8 }, (_, i) => [`ramp${String(i + 1).padStart(2, '0')}`, 60, 100 * (i + 1)]),
    ['hold', 60, 800],
    ['down', 30, 50],
    ['rec1', 30, 50],
    ['rec2', 90, 50],
  ],
  spike: [
    ['base', 60, 50],
    ['up', 10, 1000],
    ['peak', 60, 1000],
    ['down', 10, 50],
    ['rec1', 30, 50],
    ['rec2', 150, 50],
  ],
};
if (!SHAPES[SHAPE]) fail(`SHAPE phải là stress, stress800 hoặc spike, nhận ${SHAPE}`);
const PHASES = SHAPES[SHAPE];
const START_VUS = SHAPE === 'spike' ? 50 : 0;

const phaseThresholds = Object.fromEntries(
  PHASES.flatMap(([phase]) => [
    [`http_req_duration{phase:${phase}}`, ['max>=0']],
    [`http_req_failed{phase:${phase}}`, ['rate>=0']],
    [`http_reqs{phase:${phase}}`, ['count>=0']],
  ]),
);

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: START_VUS,
      stages: PHASES.map(([, seconds, target]) => ({ duration: `${seconds}s`, target })),
      gracefulRampDown: '5s',
      exec: 'act',
    },
  },
  thresholds: {
    ...phaseThresholds,
    'http_req_duration{name:read}': ['max>=0'],
    'http_req_duration{name:write}': ['max>=0'],
    paging_missing: ['count==0'],
    paging_duplicates: ['count==0'],
  },
};

export function setup() {
  const data = setupLevels();
  const startAt = Date.now();
  let at = startAt;
  const phases = PHASES.map(([name, seconds, target]) => {
    const phase = { name, startAt: at, endAt: at + seconds * 1000, target };
    at = phase.endAt;
    return phase;
  });
  return { ...data, kind: 'mixed', shape: SHAPE, startAt, endAt: at, startVus: START_VUS, phases };
}

function phaseAt(data, now) {
  for (const phase of data.phases) if (now < phase.endAt) return phase.name;
  return data.phases[data.phases.length - 1].name;
}

export function act(data) {
  // levels.js đọc KIND lúc nạp: chạy với -e KIND=mixed. Tag phase gắn vào mọi request của lượt này.
  const tags = { phase: phaseAt(data, Date.now()) };
  actLevels({ ...data, extraTags: tags });
}

// Sau stress: đi lại hết trang, bình luận chen vào lúc quá tải không được làm phân trang thiếu hay lặp.
export function teardown(data) {
  teardownLevels(data);
}

export function handleSummary(data) {
  return writeSummary(`s-${SHAPE}`, data);
}
