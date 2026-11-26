// TF120 phép 1: N khách cùng xem Reels, video tải thẳng từ CloudFront. run.sh chạy lần lượt từng mức N.
//   k6 run -e VUS=100 -e DURATION=2m --summary-export out/cdn-100.json k6/cdn.js
// Mỗi người: lấy cookie CDN một lần, mỗi reel tải master.m3u8, playlist mức ≤ 540p, rồi các đoạn video theo nhịp phát
// (2 đoạn đầu tải liền để có bộ đệm, sau đó mỗi đoạn chờ đúng thời lượng đoạn). Xem 3–8 đoạn rồi vuốt sang reel khác;
// hết 10 reel thì gọi trang feed tiếp, như app.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { feedPage, pick, pickVariant, playbackCookie, segmentUrls, TREND_STATS, walkFeed } from './lib.js';

const VUS = Number(__ENV.VUS || 50);
const SEGMENT_SEC = Number(__ENV.SEGMENT_SEC || 2);

const videoBytes = new Counter('video_bytes');
const cdnHit = new Rate('cdn_hit');
const segmentMs = new Trend('segment_ms', true);

export const options = {
  summaryTrendStats: TREND_STATS,
  setupTimeout: '2m',
  scenarios: {
    watch: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: __ENV.DURATION || '2m', target: VUS },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:feed}': ['p(95)<500'],
    'segment_ms{cache:hit}': ['p(95)<300'],
    // Không phải ngưỡng đạt/trượt: khai báo để summary có số riêng của lượt trượt cache (S3 ở Sydney).
    'segment_ms{cache:miss}': ['p(95)<5000'],
  },
};

export function setup() {
  const { cards } = walkFeed('for_you', 5);
  const reels = cards.filter((c) => c.video && c.video.hlsUrl).map((c) => c.video.hlsUrl);
  if (reels.length === 0) throw new Error('Feed không có video');
  return { reels };
}

let cookie = null;
let cookieExpiresAt = 0;
let watched = 0;

function cdnGet(url, name, responseType = 'text') {
  const res = http.get(url, { headers: { Cookie: cookie }, tags: { name }, responseType });
  const xCache = String(res.headers['X-Cache'] || '');
  const isHit = /hit/i.test(xCache);
  cdnHit.add(isHit, { name });
  const len = Number(res.headers['Content-Length'] || (res.body ? res.body.length : 0));
  if (res.status === 200) videoBytes.add(len, { name });
  return { res, isHit };
}

export default function ({ reels }) {
  if (!cookie || Date.now() > cookieExpiresAt - 60_000) {
    const s = playbackCookie();
    if (!check(s.res, { 'playback-session 200': (r) => r.status === 200 }) || !s.cookie) return sleep(1);
    cookie = s.cookie;
    cookieExpiresAt = s.expiresAt;
  }
  if (++watched % 10 === 0)
    check(feedPage({ tags: { name: 'feed' } }), { 'feed 200': (r) => r.status === 200 });

  const masterUrl = pick(reels);
  const master = cdnGet(masterUrl, 'hls_master').res;
  if (!check(master, { 'master 200': (r) => r.status === 200 })) return sleep(1);
  const variantUrl = pickVariant(masterUrl, master.body);
  if (!variantUrl) return;
  const playlist = cdnGet(variantUrl, 'hls_playlist').res;
  if (!check(playlist, { 'playlist 200': (r) => r.status === 200 })) return sleep(1);

  const segments = segmentUrls(variantUrl, playlist.body);
  const watchCount = Math.min(segments.length, 3 + Math.floor(Math.random() * 6));
  for (let i = 0; i < watchCount; i++) {
    const started = Date.now();
    const { res, isHit } = cdnGet(segments[i], 'hls_segment', 'none');
    check(res, { 'segment 200': (r) => r.status === 200 });
    segmentMs.add(res.timings.duration, { cache: isHit ? 'hit' : 'miss' });
    if (i >= 1) sleep(Math.max(0, SEGMENT_SEC - (Date.now() - started) / 1000));
  }
}
