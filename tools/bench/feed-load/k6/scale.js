// TF120 phép 2: khách lướt feed ở một tốc độ cố định (request/giây). run.sh chạy lần lượt từng mức.
//   k6 run -e RATE=100 -e DURATION=60s --summary-export out/scale-100.json k6/scale.js
// Mỗi lượt là một request. MIX=mixed (mặc định): 30% trang đầu "Dành cho bạn", 50% trang 2–5 theo cursor có sẵn,
// 20% trang đầu "Đang hot". MIX=hot: chỉ "Đang hot", 30% trang đầu, 70% trang 2–5. Tab hot đọc theo bộ đếm có index,
// nhẹ cho Postgres, nên dùng để thấy thêm bản core-api có tăng sức chịu không khi nút thắt không nằm ở database.
import { check } from 'k6';
import { feedPage, pick, TREND_STATS, walkFeed } from './lib.js';

const RATE = Number(__ENV.RATE || 50);
const MIX = __ENV.MIX || 'mixed';

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '2m',
  scenarios: {
    feed: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Math.max(20, RATE),
      maxVUs: Math.max(100, RATE * 4),
    },
  },
  // "Bền vững" của TF120: p95 < 500 ms và lỗi < 1%. Trượt ngưỡng không dừng lượt đo, chỉ đánh dấu.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:feed}': ['p(95)<500'],
    // Không phải ngưỡng: khai báo để summary có số request đo riêng, không lẫn request của setup.
    'http_reqs{name:feed}': ['count>=0'],
  },
};

export function setup() {
  // Lấy cursor trang 2–5 của nhiều lượt trang đầu (mỗi lượt một seed khác nhau).
  const tab = MIX === 'hot' ? 'hot' : 'for_you';
  const cursors = [];
  for (let i = 0; i < 8; i++) cursors.push(...walkFeed(tab, 5).cursors);
  if (cursors.length === 0) throw new Error('Feed không có trang 2: staging quá ít bài để đo');
  return { cursors };
}

export default function ({ cursors }) {
  const r = Math.random();
  let res;
  if (MIX === 'hot') {
    res =
      r < 0.3
        ? feedPage({ tab: 'hot', tags: { name: 'feed', page: 'hot' } })
        : feedPage({ tab: 'hot', cursor: pick(cursors), tags: { name: 'feed', page: 'hot_next' } });
  } else if (r < 0.3) res = feedPage({ tab: 'for_you', tags: { name: 'feed', page: 'first' } });
  else if (r < 0.8)
    res = feedPage({ tab: 'for_you', cursor: pick(cursors), tags: { name: 'feed', page: 'next' } });
  else res = feedPage({ tab: 'hot', tags: { name: 'feed', page: 'hot' } });
  check(res, { 'feed 200': (x) => x.status === 200 });
}
