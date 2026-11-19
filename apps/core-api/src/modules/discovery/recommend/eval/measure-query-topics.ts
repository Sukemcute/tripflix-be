/**
 * Đo biên QUERY_MARGIN cho câu tìm (bins.ts) trên query-topics.samples.json bằng ai-service thật.
 * Chạy trong container core-api (có biến môi trường của ai-service), sau khi build:
 *   docker exec tripflix-core-api-1 node apps/core-api/dist/modules/discovery/recommend/eval/measure-query-topics.js
 * Không ghi gì, chỉ in bảng.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXP_DESCRIPTION_TEXTS, expsOfQuery } from '../domain/bins.js';
import { EXP } from '../domain/topics.js';
import { AiEmbeddingClient } from '../infra/ai-embedding.client.js';

interface Sample {
  q: string;
  expected: string | null;
}

const print = (line: string) => process.stdout.write(`${line}\n`);
const MARGINS = [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04];

async function main(): Promise<void> {
  const file = join(process.cwd(), 'apps/core-api/src/modules/discovery/recommend/eval/query-topics.samples.json');
  const { samples } = JSON.parse(readFileSync(file, 'utf8')) as { samples: Sample[] };
  const client = new AiEmbeddingClient({
    aiUrl: process.env.AI_SERVICE_URL,
    coreUrl: process.env.CORE_API_INTERNAL_URL,
    secret: process.env.MODERATION_SERVICE_CLIENT_SECRET,
  });
  const embedded = await client.embed([...EXP_DESCRIPTION_TEXTS, ...samples.map((s) => s.q)]);
  if (!embedded) throw new Error('Không gọi được ai-service /embed');
  print(`model: ${embedded.model}`);
  const descriptions = embedded.vectors.slice(0, EXP.length);
  const rows = samples.map((s, k) => {
    const v = embedded.vectors[EXP.length + k]!;
    const scored = EXP.map((exp, i) => [`exp:${exp}`, descriptions[i]!.reduce((sum, x, j) => sum + x * v[j]!, 0)] as const).sort((a, b) => b[1] - a[1]);
    return { ...s, keyword: expsOfQuery(s.q), top: scored[0]![0], gap: scored[0]![1] - scored[1]![1] };
  });
  for (const r of rows) {
    print(`${r.q.padEnd(34)} | đúng ${String(r.expected).padEnd(14)} | từ khoá ${(r.keyword.join(',') || '-').padEnd(24)} | embed ${r.top.padEnd(14)} biên ${r.gap.toFixed(4)}`);
  }
  // Chỉ đo những câu từ khoá không bắt được: embed là đường dự phòng của chúng.
  const misses = rows.filter((r) => r.keyword.length === 0);
  print(`\n${misses.length}/${rows.length} câu từ khoá không bắt được, đo embed trên các câu này:`);
  for (const m of MARGINS) {
    const assigned = misses.filter((r) => r.gap >= m);
    const right = assigned.filter((r) => r.top === r.expected).length;
    const wrong = assigned.length - right;
    const missedTopic = misses.filter((r) => r.expected && !(r.gap >= m && r.top === r.expected)).length;
    print(`biên ${m.toFixed(3)}: gán ${assigned.length}, đúng ${right}, sai ${wrong}, câu có chủ đề bị bỏ lỡ ${missedTopic}`);
  }
}

void main();
