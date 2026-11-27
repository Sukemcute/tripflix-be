// TF120 phép 4: bắn dồn lượt xem vào POST /api/v1/feed/events, xem API có giữ nhanh khi stream dồn việc.
//   k6 run -e VUS=500 --summary-export out/events-500.json k6/events.js
// Toàn bộ là khách, xem dưới 2 giây trên bài dài ít nhất 4 giây: không đạt "xem đủ" (15 giây hoặc 50%) nên không vào
// điểm hot (trend-signal.ts), discovery bỏ qua khách (to-raw-rows.ts). Analytics vẫn nhận.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API, JSON_HEADERS, pick, TREND_STATS, uuid, walkFeed } from './lib.js';

const VUS = Number(__ENV.VUS || 500);
const BATCH = Number(__ENV.BATCH || 3);
const PAUSE_SEC = Number(__ENV.PAUSE_SEC || 2);
const RAMP_SEC = 30;
const HOLD_SEC = Number(__ENV.HOLD_SEC || 60);
// stream:app-events chỉ giữ khoảng 100.000 sự kiện (libs/event-bus MAXLEN): vượt là mất sự kiện thật chưa đọc.
const MAX_EVENTS = Number(__ENV.MAX_EVENTS || 60_000);

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '2m',
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMP_SEC}s`, target: VUS },
        { duration: `${HOLD_SEC}s`, target: VUS },
        { duration: '5s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:feed_events}': ['p(95)<300'],
  },
};

export function setup() {
  const requests = (VUS * (RAMP_SEC / 2 + HOLD_SEC)) / PAUSE_SEC;
  const events = Math.round(requests * BATCH);
  if (events > MAX_EVENTS)
    throw new Error(`Ước tính ${events} sự kiện > ${MAX_EVENTS}: giảm VUS, BATCH hoặc HOLD_SEC`);
  const { cards } = walkFeed('for_you', 5);
  const postIds = cards.filter((c) => c.video && c.video.durationSec >= 4).map((c) => c.postId);
  if (postIds.length === 0) throw new Error('Không có bài video dài từ 4 giây');
  console.log(`Ước tính ${events} sự kiện, ${postIds.length} bài`);
  return { postIds };
}

let anonId = null;

export default function ({ postIds }) {
  if (!anonId) anonId = uuid();
  const events = Array.from({ length: BATCH }, () => ({
    eventId: uuid(),
    type: 'view',
    postId: pick(postIds),
    watchedMs: 1000 + Math.floor(Math.random() * 900),
    surface: 'reels',
  }));
  const res = http.post(`${API}/feed/events`, JSON.stringify({ events }), {
    headers: { ...JSON_HEADERS, 'X-Anon-Id': anonId },
    tags: { name: 'feed_events' },
  });
  check(res, { 'events 202': (r) => r.status === 202 });
  sleep(PAUSE_SEC);
}
