// Regression against an isolated Tempo 2.9 fixture; never point this at staging/production.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const { ObservabilityService } = await import(new URL('../apps/core-api/dist/modules/analytics/observability/application/observability.service.js', import.meta.url).href);
const base = 'http://127.0.0.1:3215';
for (let attempt = 0; attempt < 45; attempt++) {
  if (await fetch(`${base}/ready`).then((response) => response.ok).catch(() => false)) break;
  await setTimeout(1000);
}
const service = new ObservabilityService({ ANALYTICS_TEMPO_URL: base });
const now = BigInt(Date.now()) * 1_000_000n;
const cases = [
  { name: 'OPTIONS CORS preflight', code: 204, child: true, hidden: true },
  { name: 'OPTIONS unmatched', code: 403 },
  { name: 'OPTIONS unmatched', code: 503 },
  { name: 'OPTIONS unmatched', code: 204 }, // Legacy, no confirmed classification.
  { name: 'OPTIONS /api/capabilities', code: 200 },
  { name: 'GET /api/posts', code: 200 },
  { name: 'GET unmatched', code: 404 },
];
const spans = cases.flatMap((fixture) => {
  fixture.id = randomBytes(16).toString('hex');
  const id = randomBytes(8).toString('hex');
  const root = { traceId: fixture.id, spanId: id, name: fixture.name, kind: 2, startTimeUnixNano: String(now), endTimeUnixNano: String(now + 100_000_000n), attributes: [{ key: 'http.response.status_code', value: { intValue: String(fixture.code) } }], status: { code: fixture.code >= 500 ? 2 : 0 } };
  return fixture.child ? [root, { ...root, spanId: randomBytes(8).toString('hex'), parentSpanId: id, name: 'SQL child must not bypass root filter', kind: 3 }] : [root];
});
const ingest = await fetch('http://127.0.0.1:4319/v1/traces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'preflight-test' } }] }, scopeSpans: [{ scope: { name: 'regression' }, spans }] }] }) });
assert(ingest.ok, `OTLP ingestion: ${ingest.status}`);
const query = { range: '1h', service: 'preflight-test', errorsOnly: false, minDurationMs: 0 };
let all;
for (let attempt = 0; attempt < 45; attempt++) {
  all = await service.listTraces({ ...query, includeSuccessfulPreflights: true });
  if (all.source.status === 'ready' && all.traces.length === cases.length) break;
  await setTimeout(1000);
}
assert.equal(all.traces.length, cases.length, 'Show-all retains all fixture traces');
const filtered = await service.listTraces({ ...query, includeSuccessfulPreflights: false });
assert.equal(filtered.source.status, 'ready');
assert.deepEqual(filtered.traces.map((trace) => trace.traceId).sort(), cases.filter((fixture) => !fixture.hidden).map((fixture) => fixture.id).sort());
const errors = await service.listTraces({ ...query, includeSuccessfulPreflights: false, errorsOnly: true });
assert.deepEqual(errors.traces.map((trace) => trace.traceId), cases.filter((fixture) => fixture.code >= 500).map((fixture) => fixture.id));
const slow = await service.listTraces({ ...query, includeSuccessfulPreflights: false, minDurationMs: 150 });
assert.equal(slow.traces.length, 0);
console.log(JSON.stringify({ passed: true, all: all.traces.length, default: filtered.traces.length, errors: errors.traces.length, cases: ['hide confirmed preflight with child', 'keep failed preflight', 'keep legacy OPTIONS', 'keep ordinary OPTIONS', 'keep HTTP/non-preflight traces', 'preserve error/duration filters'] }));
