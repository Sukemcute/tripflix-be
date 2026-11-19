import { SESSION_KINDS } from '../application/ingest.use-cases.js';
import { profileFeaturesOf } from '../domain/builders/post-profile.js';
import { tagAffinityV0 } from '../domain/builders/tag-affinity.js';
import { tripProfileV1 } from '../domain/builders/trip-profile.js';
import { assignBins, primaryPlace } from '../domain/bins.js';
import { mergeCandidates } from '../domain/candidates.js';
import type { Candidate, PostMeta, RankedItem } from '../domain/contracts.js';
import { applyFeedPolicy } from '../domain/feed-policy.js';
import { tagAffinityRankerV0 } from '../domain/rankers/rankers.js';
import { tripRankerV1 } from '../domain/rankers/trip-v1.js';
import { blendSessionTaste } from '../domain/session-taste.js';
import { RECENT_WINDOW_MS } from '../infra/redis-recent-posts.store.js';
import { hitAt, maxSamePlaceRun, placeCoverageAt, placeShareAt } from './metrics.js';
import type { EvalPost, Persona, Stage } from './personas.js';

/** Một thuật toán chạy được trong bộ đo: trả danh sách đã qua feed-policy, chưa trộn ô khám phá. */
export interface EvalAlgo {
  name: string;
  recommend(persona: Persona, posts: EvalPost[], now: Date): Promise<RankedItem[]>;
}

// Giống post-recommendations.use-cases.ts: 150 bài hot + 50 bài đăng trong 48 giờ.
const HOT_LIMIT = 150;
const FRESH_LIMIT = 50;
const FRESH_HOURS = 48;

/** Bài fixture → PostMeta giống job: có content để builder v1 tự xếp ngăn. */
export const toMeta = (p: EvalPost): PostMeta => ({
  postId: p.postId,
  authorId: p.authorId,
  postType: p.postType,
  tags: p.tags,
  placeId: p.placeId,
  hasPlan: p.hasPlan,
  content: { title: p.title, body: p.body, isVerified: p.isVerified, trip: p.trip },
});
const toCandidate = (p: EvalPost, source: Candidate['source']): Candidate => ({ ...toMeta(p), score: p.hot ?? 0, postFeatures: {}, source });

const interactedPostIds = (persona: Persona) =>
  new Set(persona.rows.filter((r) => r.targetType === 'post' && r.targetId && !r.isRemoved).map((r) => r.targetId!));

/** for_you đang chạy (v0): hot@v2 + tag_affinity@v0 + tag_affinity_v0, lấy ứng viên đúng như store. */
export const forYouV0: EvalAlgo = {
  name: 'v0 (tag_affinity_v0, 150 hot + 50 mới)',
  async recommend(persona, posts, now) {
    const visible = posts.filter((p) => Date.parse(p.publishedAt) <= now.getTime());
    const hot = [...visible]
      .sort((a, b) => (b.hot ?? 0) - (a.hot ?? 0) || b.publishedAt.localeCompare(a.publishedAt) || b.postId.localeCompare(a.postId))
      .slice(0, HOT_LIMIT)
      .map((p) => toCandidate(p, 'hot'));
    const freshSince = now.getTime() - FRESH_HOURS * 3_600_000;
    const fresh = visible
      .filter((p) => Date.parse(p.publishedAt) > freshSince)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.postId.localeCompare(a.postId))
      .slice(0, FRESH_LIMIT)
      .map((p) => toCandidate(p, 'fresh'));

    let userFeatures: Record<string, unknown> | null = null;
    if (persona.stage !== 'guest') {
      const metas = Object.fromEntries(posts.map((p) => [p.postId, toMeta(p)]));
      const [built] = await tagAffinityV0.build([{ userId: persona.id, rows: persona.rows, posts: metas, productPlaces: persona.productPlaces }], now);
      // Gu trong phiên: bài vừa tương tác trong 2 giờ, như luồng nhanh Redis.
      const recent = persona.rows
        .filter((r) => r.targetType === 'post' && r.targetId && SESSION_KINDS.has(r.kind) && now.getTime() - Date.parse(r.occurredAt) <= RECENT_WINDOW_MS)
        .flatMap((r) => (metas[r.targetId!] ? [{ meta: metas[r.targetId!]!, at: Date.parse(r.occurredAt) }] : []));
      userFeatures = blendSessionTaste(built?.features ?? null, recent, now.getTime());
    }

    const ranked = tagAffinityRankerV0.rank({ candidates: mergeCandidates(hot, fresh), userFeatures, now });
    return applyFeedPolicy(ranked, {
      userId: persona.stage === 'guest' ? null : persona.id,
      seen: new Set(),
      interacted: interactedPostIds(persona),
      ownRecent: new Set(),
    });
  },
};

/** for_you v1: post_profile@v1 + trip_profile@v1 + trip_v1, đọc toàn bộ bài và dòng thô của người xem như use case. */
export const forYouV1: EvalAlgo = {
  name: 'v1 (trip_v1, đọc toàn bộ bài)',
  async recommend(persona, posts, now) {
    const candidates: Candidate[] = posts
      .filter((p) => Date.parse(p.publishedAt) <= now.getTime())
      .map((p) => ({ ...toCandidate(p, 'hot'), postFeatures: profileFeaturesOf(toMeta(p)) }));
    const isGuest = persona.stage === 'guest';
    let userFeatures: Record<string, unknown> | null = null;
    if (!isGuest) {
      const metas = Object.fromEntries(posts.map((p) => [p.postId, toMeta(p)]));
      const [built] = await tripProfileV1.build([{ userId: persona.id, rows: persona.rows, posts: metas, productPlaces: persona.productPlaces }], now);
      userFeatures = built?.features ?? null;
    }
    const viewer = isGuest ? null : { rows: persona.rows, productPlaces: persona.productPlaces };
    const ranked = tripRankerV1.rank({ candidates, userFeatures, now, viewer });
    return applyFeedPolicy(ranked, { userId: isGuest ? null : persona.id, seen: new Set(), interacted: interactedPostIds(persona), ownRecent: new Set() });
  },
};

export interface PersonaResult {
  persona: Persona;
  hit20: number | null;
  targetShare10: number | null;
  avoidShare10: number | null;
  placeCoverage20: number;
  maxRun20: number;
  otherHotels10: number | null;
  reasons: string[];
}

export async function runEval(algo: EvalAlgo, personas: Persona[], posts: EvalPost[], now: Date): Promise<PersonaResult[]> {
  const byId = new Map(posts.map((p) => [p.postId, p]));
  const results: PersonaResult[] = [];
  for (const persona of personas) {
    const ranked = await algo.recommend(persona, posts, now);
    const ids = ranked.map((r) => r.postId);
    // Nơi của bài = nơi chính theo ngăn (P1), như ranker thấy; placeId cũ của job bỏ sót bài chỉ có tag nơi.
    const placeOf = new Map(posts.map((p) => [p.postId, primaryPlace(binsOf(p))]));
    const places = ids.map((id) => placeOf.get(id) ?? null);
    const top10 = ids.slice(0, 10).map((id) => byId.get(id));
    results.push({
      persona,
      hit20: hitAt(ids, persona.holdout, 20),
      targetShare10: placeShareAt(places, persona.targetPlaces, 10),
      avoidShare10: placeShareAt(places, persona.avoidPlaces, 10),
      placeCoverage20: placeCoverageAt(places, 20),
      maxRun20: maxSamePlaceRun(places, 20),
      otherHotels10: persona.bookedHotelId
        ? top10.filter((p) => p?.trip?.hotelId && persona.targetPlaces.includes(placeOf.get(p.postId) ?? '') && p.trip.hotelId !== persona.bookedHotelId).length
        : null,
      reasons: [...new Set(ranked.slice(0, 10).map((r) => r.reason.text))].slice(0, 3),
    });
  }
  return results;
}

const STAGE_LABEL: Record<Stage, string> = {
  dreaming: 'Mơ',
  planning: 'Lên kế hoạch',
  upcoming: 'Sắp đi',
  on_trip: 'Đang đi',
  after_trip: 'Vừa về',
  guest: 'Khách',
};

/** Ngưỡng đạt theo thiết kế v1 mục 4 (đúng nơi hạ 0,5 → 0,4 theo trần 4/10 của feed-policy, 19/11); persona không có chỉ số đó thì "–". */
const GOAL: Record<Stage, string> = {
  dreaming: 'số nơi ≥ 4, chuỗi ≤ 3',
  planning: 'đúng nơi ≥ 0,4',
  upcoming: 'đúng nơi ≥ 0,4, KS khác ≤ 1',
  on_trip: 'đúng nơi ≥ 0,4',
  after_trip: 'nơi vừa đi ≤ 0,2',
  guest: 'như trending',
};

const fmt = (x: number | null) => (x === null ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ','));

/** Ngăn của từng bài fixture, đúng như post_profile@v1 tính trong job. */
export const binsOf = (p: EvalPost) => assignBins(toMeta(p));

/** Độ phủ ngăn trên fixture: số bài mỗi ngăn, bài không có nơi / không có trải nghiệm nào. */
export function formatBinStats(posts: EvalPost[]): string {
  const counts = new Map<string, number>();
  let noPlace = 0;
  let noExp = 0;
  for (const p of posts) {
    const bins = Object.keys(binsOf(p));
    if (!bins.some((b) => b.startsWith('place:'))) noPlace++;
    if (!bins.some((b) => b.startsWith('exp:'))) noExp++;
    for (const b of bins) if (!b.startsWith('place:')) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([bin, n]) => `| \`${bin}\` | ${n} |`);
  return [
    '### Ngăn của bài (post_profile@v1)',
    '',
    `${posts.length} bài: ${posts.length - noPlace} có nơi, ${noPlace} không có nơi; ${noExp} không có ngăn trải nghiệm nào.`,
    '',
    '| Ngăn | Số bài |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n');
}

/** Bảng markdown một thuật toán: mỗi persona một dòng. */
export function formatReport(algo: EvalAlgo, results: PersonaResult[]): string {
  const head = [
    `### ${algo.name}`,
    '',
    '| Persona | Giai đoạn | Mục tiêu | hit@20 | đúng nơi@10 | nơi vừa đi@10 | số nơi@20 | chuỗi cùng nơi@20 | KS khác@10 | Lý do top 10 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const lines = results.map((r) =>
    [
      `\`${r.persona.id}\``,
      STAGE_LABEL[r.persona.stage],
      GOAL[r.persona.stage],
      fmt(r.hit20),
      fmt(r.targetShare10),
      fmt(r.avoidShare10),
      fmt(r.placeCoverage20),
      fmt(r.maxRun20),
      fmt(r.otherHotels10),
      r.reasons.join(' · '),
    ].join(' | '),
  );
  return [...head, ...lines.map((l) => `| ${l} |`), ''].join('\n');
}
