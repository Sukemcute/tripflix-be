// TF99: đầu đo nạp vào core-api lúc đo tải, không sửa code ứng dụng:
//   BENCH_PROBE_FILE=<file> NODE_OPTIONS="--import ./tools/bench/comments/probe.mjs" node dist/main.js
// Mỗi giây ghi một dòng JSON: luồng chính bận bao nhiêu (ELU), độ trễ event loop, GC, heap, request đang xử lý và
// thời gian xử lý phía server, pool Postgres (đang mượn, rảnh, đang chờ), thời gian chờ mượn kết nối và thời gian câu truy vấn.
// Không đặt BENCH_PROBE_FILE thì không làm gì. Chỉ chạy ở luồng chính: NODE_OPTIONS cũng nạp vào worker thread của pino.
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import diagnostics from 'node:diagnostics_channel';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import { isMainThread } from 'node:worker_threads';

const FILE = process.env.BENCH_PROBE_FILE;

if (FILE && isMainThread) {
  // pg của libs/db (cùng bản thật mà core-api dùng: pnpm trỏ về một thư mục nên require cache dùng chung).
  const require = createRequire(join(process.cwd(), '../../libs/db/package.json'));
  const pg = require('pg');
  const pools = new Set();
  let connectWaitMs = 0;
  let connectCount = 0;
  let queryMs = 0;
  let queryCount = 0;
  // Câu truy vấn theo pool (module) và theo mẫu câu (80 ký tự đầu): biết câu nào, của ai, tốn nhiều nhất.
  let queriesByPool = {};
  let queriesBySignature = {};
  const signatureOf = (args) => {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 80) : '(khác)';
  };

  const originalConnect = pg.Pool.prototype.connect;
  pg.Pool.prototype.connect = function connect(callback) {
    pools.add(this);
    const startedAt = performance.now();
    const settle = () => {
      connectWaitMs += performance.now() - startedAt;
      connectCount += 1;
    };
    if (typeof callback === 'function') {
      return originalConnect.call(this, (...args) => {
        settle();
        return callback(...args);
      });
    }
    const result = originalConnect.call(this);
    result.then(settle, settle);
    return result;
  };

  const originalQuery = pg.Client.prototype.query;
  pg.Client.prototype.query = function query(...args) {
    const startedAt = performance.now();
    const pool = this.connectionParameters?.application_name ?? 'khác';
    const signature = signatureOf(args);
    const settle = () => {
      const ms = performance.now() - startedAt;
      queryMs += ms;
      queryCount += 1;
      const byPool = (queriesByPool[pool] ??= { count: 0, ms: 0 });
      byPool.count += 1;
      byPool.ms += ms;
      const bySignature = (queriesBySignature[`${pool} · ${signature}`] ??= { count: 0, ms: 0 });
      bySignature.count += 1;
      bySignature.ms += ms;
    };
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      const callback = args[last];
      args[last] = (...cbArgs) => {
        settle();
        return callback(...cbArgs);
      };
      return originalQuery.apply(this, args);
    }
    const result = originalQuery.apply(this, args);
    if (result && typeof result.then === 'function') result.then(settle, settle);
    return result;
  };

  // Thời gian phía server: từ lúc Node đọc xong đầu request tới lúc gửi xong phản hồi. Thời gian k6 thấy trừ số này
  // là phần nằm ngoài handler: mạng, và hàng chờ trước khi luồng chính rảnh để đọc request.
  const startedAtByRequest = new WeakMap();
  let inFlight = 0;
  let serverDurations = [];
  // Số phản hồi theo nhóm mã (2xx, 4xx, 5xx) mỗi giây: stress test cần biết lỗi bắt đầu từ lúc nào.
  let statusCounts = {};
  diagnostics.subscribe('http.server.request.start', ({ request }) => {
    inFlight += 1;
    startedAtByRequest.set(request, performance.now());
  });
  diagnostics.subscribe('http.server.response.finish', ({ request, response }) => {
    inFlight -= 1;
    const group = `${Math.floor((response?.statusCode ?? 0) / 100)}xx`;
    statusCounts[group] = (statusCounts[group] ?? 0) + 1;
    const startedAt = startedAtByRequest.get(request);
    if (startedAt !== undefined) serverDurations.push(Math.round((performance.now() - startedAt) * 10) / 10);
  });

  let gcMs = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) gcMs += entry.duration;
  }).observe({ entryTypes: ['gc'] });

  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  let lastElu = performance.eventLoopUtilization();

  const sample = () => {
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    const memory = process.memoryUsage();
    const poolStats = {};
    for (const pool of pools) {
      const name = pool.options?.application_name ?? 'pool';
      poolStats[name] = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max };
    }
    const line = {
      t: Date.now(),
      elu: Math.round(elu.utilization * 1000) / 1000,
      loopP50: Math.round(loopDelay.percentile(50) / 1e4) / 100,
      loopP99: Math.round(loopDelay.percentile(99) / 1e4) / 100,
      loopMax: Math.round(loopDelay.max / 1e4) / 100,
      gcMs: Math.round(gcMs * 10) / 10,
      heapMB: Math.round(memory.heapUsed / 1048576),
      rssMB: Math.round(memory.rss / 1048576),
      inFlight,
      server: serverDurations,
      status: statusCounts,
      connectWaitMs: Math.round(connectWaitMs * 10) / 10,
      connectCount,
      queryMs: Math.round(queryMs * 10) / 10,
      queryCount,
      pools: poolStats,
      queriesByPool,
      queriesBySignature,
    };
    appendFileSync(FILE, `${JSON.stringify(line)}\n`);
    loopDelay.reset();
    gcMs = 0;
    serverDurations = [];
    statusCounts = {};
    connectWaitMs = 0;
    connectCount = 0;
    queryMs = 0;
    queryCount = 0;
    queriesByPool = {};
    queriesBySignature = {};
  };
  setInterval(sample, 1000).unref();
}
