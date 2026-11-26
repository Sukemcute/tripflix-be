// TF99: lấy CPU profile của core-api qua DevTools Protocol rồi chia thời gian CPU theo nhóm (thư viện, code app, GC, rảnh).
//   node tools/bench/comments/profile.mjs <giây> <file kết quả .json> [cổng inspector, mặc định 9229]
// core-api phải chạy với --inspect=127.0.0.1:9229. Chỉ dùng trên máy local.
import { writeFileSync } from 'node:fs';

const [seconds = '20', outFile = 'profile.json', port = '9229'] = process.argv.slice(2);

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 1;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Profiler.start');
await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
const { profile } = await send('Profiler.stop');
socket.close();

// Nhóm theo nơi hàm nằm: gói trong node_modules, code app theo module, nội bộ Node, GC, rảnh.
function groupOf(frame) {
  const { url, functionName } = frame;
  if (functionName === '(idle)') return 'rảnh (chờ I/O)';
  if (functionName === '(garbage collector)') return 'GC';
  if (functionName === '(program)') return 'V8/native';
  if (!url) return 'V8/native';
  const pkg = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(url);
  if (pkg) return pkg[1];
  if (url.startsWith('node:')) {
    if (/net|stream|http|_http/.test(url)) return 'node: mạng, http, stream';
    return 'node: khác';
  }
  const app = /dist\/modules\/([^/]+)\/([^/]+)?/.exec(url);
  if (app) return `app: ${app[1]}${app[2] && !app[2].endsWith('.js') ? `/${app[2]}` : ''}`;
  if (/libs\//.test(url)) return `libs: ${/libs\/([^/]+)/.exec(url)?.[1]}`;
  if (/dist\/platform/.test(url)) return 'app: platform';
  return 'app: khác';
}

const byId = new Map(profile.nodes.map((node) => [node.id, node]));
const sampleCount = new Map();
for (const id of profile.samples) sampleCount.set(id, (sampleCount.get(id) ?? 0) + 1);
const totalSamples = profile.samples.length;
const groups = {};
const functions = {};
for (const [id, count] of sampleCount) {
  const frame = byId.get(id).callFrame;
  const group = groupOf(frame);
  groups[group] = (groups[group] ?? 0) + count;
  const fnKey = `${frame.functionName || '(anonymous)'} · ${group}`;
  functions[fnKey] = (functions[fnKey] ?? 0) + count;
}
const toShare = (entries) =>
  Object.entries(entries)
    .map(([name, count]) => ({ name, share: Math.round((count / totalSamples) * 1000) / 10 }))
    .sort((a, b) => b.share - a.share);

const summary = {
  seconds: Number(seconds),
  samples: totalSamples,
  groups: toShare(groups),
  topFunctions: toShare(functions).slice(0, 25),
};
writeFileSync(outFile, JSON.stringify(summary, null, 2));
writeFileSync(outFile.replace(/\.json$/, '.cpuprofile'), JSON.stringify(profile));
process.stdout.write(`${summary.groups.slice(0, 12).map((g) => `${g.share}% ${g.name}`).join('\n')}\n`);
