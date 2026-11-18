import { readFileSync } from 'node:fs';
import { answerLive } from '../domain/live-answers.js';
import { hitAt, maxSamePlaceRun, placeCoverageAt, placeShareAt } from './metrics.js';
import { buildPersonas, EVAL_NOW, type EvalPost } from './personas.js';
import { formatBinStats, formatReport, forYouV0, runEval, toMeta } from './run-eval.js';

/**
 * Bộ đo offline for-you (TF28, thiết kế v1 mục 4).
 * Fixture: 243 bài mô phỏng dump từ DB local ngày 18/11 (recommend_posts + content.posts + điểm hot@v2), lệnh dump ở report.md.
 * Đổi thuật toán → chạy `pnpm --filter @tripflix/core-api exec vitest run src/modules/discovery/recommend/eval -u`
 * rồi xem diff của report.md: đó là số trước/sau.
 */
const posts = JSON.parse(readFileSync(new URL('./fixtures/posts-2026-11-18.json', import.meta.url), 'utf8')) as EvalPost[];

describe('metrics', () => {
  it('hitAt: có đáp án trong top k', () => {
    expect(hitAt(['a', 'b', 'c'], ['c'], 3)).toBe(1);
    expect(hitAt(['a', 'b', 'c'], ['c'], 2)).toBe(0);
    expect(hitAt(['a'], [], 20)).toBeNull();
  });

  it('placeShareAt: tỉ lệ bài ở nơi cần, bài không có nơi tính là không khớp', () => {
    expect(placeShareAt(['nt', null, 'dl', 'nt'], ['nt'], 4)).toBe(0.5);
    expect(placeShareAt(['nt'], [], 10)).toBeNull();
    expect(placeShareAt([], ['nt'], 10)).toBe(0);
  });

  it('placeCoverageAt và maxSamePlaceRun: bỏ bài không có nơi, null cắt chuỗi', () => {
    const places = ['nt', 'nt', null, 'nt', 'dl', 'dl', 'dl'];
    expect(placeCoverageAt(places, 7)).toBe(2);
    expect(maxSamePlaceRun(places, 7)).toBe(3);
    expect(maxSamePlaceRun(places, 3)).toBe(2);
  });
});

describe('personas', () => {
  const personas = buildPersonas(posts);

  it('tất định, đủ 5 giai đoạn + khách, chỉ trỏ tới bài có trong fixture', () => {
    expect(buildPersonas(posts)).toEqual(personas);
    expect(new Set(personas.map((p) => p.stage))).toEqual(new Set(['dreaming', 'planning', 'upcoming', 'on_trip', 'after_trip', 'guest']));
    const ids = new Set(posts.map((p) => p.postId));
    for (const persona of personas) {
      for (const r of persona.rows) if (r.targetType === 'post') expect(ids.has(r.targetId!)).toBe(true);
      for (const id of persona.holdout) expect(ids.has(id)).toBe(true);
    }
  });

  it('bài đáp án không nằm trong lịch sử của persona', () => {
    for (const persona of personas) {
      const seen = new Set(persona.rows.map((r) => r.targetId));
      for (const id of persona.holdout) expect(seen.has(id)).toBe(false);
    }
  });
});

describe('báo cáo bộ đo', () => {
  it('ghi kết quả từng thuật toán vào report.md', async () => {
    const personas = buildPersonas(posts);
    const sections = [];
    for (const algo of [forYouV0]) sections.push(formatReport(algo, await runEval(algo, personas, posts, EVAL_NOW)));
    const intro = [
      '# Bộ đo offline for-you (TF28)',
      '',
      'Sinh tự động bởi `recommend-eval.spec.ts`, không sửa tay. Thiết kế: thiết kế v1 mục 4 (tài liệu riêng của Duy).',
      '',
      `- "Hôm nay" của bộ đo: ${EVAL_NOW.toISOString()}. ${posts.length} bài trong \`fixtures/posts-2026-11-18.json\`.`,
      '- Danh sách đã qua feed-policy, chưa trộn ô khám phá (ô này ngẫu nhiên theo thiết kế).',
      '- `đúng nơi@10`: tỉ lệ top 10 ở nơi persona đang nhắm / đã đặt / thật sự thích. `nơi vừa đi@10`: tỉ lệ top 10 ở nơi vừa về.',
      '- `KS khác@10`: số bài trong top 10 gắn khách sạn khác ở nơi đã đặt.',
      '',
      'Dump lại fixture (DB local, xem `fixtures/dump-posts.sql`):',
      '',
      '```',
      'docker exec -i tripflix-postgres-1 psql -U postgres -d core -A -t < fixtures/dump-posts.sql',
      '```',
      '',
    ];
    await expect([...intro, formatBinStats(posts), ...sections].join('\n')).toMatchFileSnapshot('./report.md');
  });
});

describe('câu trả lời tức thời trên persona', () => {
  const metas = Object.fromEntries(posts.map((p) => [p.postId, toMeta(p)]));

  it('giai đoạn suy ra khớp giai đoạn persona; lên kế hoạch thì nơi nhắm mạnh nhất nằm trong nơi mục tiêu', () => {
    for (const persona of buildPersonas(posts).filter((p) => p.stage !== 'guest')) {
      const live = answerLive({ rows: persona.rows, posts: metas, productPlaces: persona.productPlaces, now: EVAL_NOW });
      expect([persona.id, live.stage]).toEqual([persona.id, persona.stage]);
      if (persona.stage === 'planning') {
        const top = Object.entries(live.exploring).sort((a, b) => b[1] - a[1])[0]![0];
        expect(persona.targetPlaces.map((p) => `place:${p}`)).toContain(top);
      }
    }
  });
});
