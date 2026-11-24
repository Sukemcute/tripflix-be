import { createHash } from 'node:crypto';
import { round4, type Candidate, type RankedItem } from './contracts.js';

/** ~5% vị trí mỗi trang lấy ngẫu nhiên (đề xuất 6.2): tập đáp án không chệch để so thuật toán offline. */
export const EXPLORE_RATE = 0.05;

/** Gộp các nguồn theo thứ tự ưu tiên, bỏ trùng: bài có ở nhiều nguồn giữ source của nguồn đầu. */
export function mergeCandidates(...sources: Candidate[][]): Candidate[] {
  const seen = new Set<string>();
  const merged: Candidate[] = [];
  for (const c of sources.flat()) {
    if (seen.has(c.postId)) continue;
    seen.add(c.postId);
    merged.push(c);
  }
  return merged;
}

/** Trang nhỏ (web lấy 7 bài) làm tròn 5% ra 0: giữ tối thiểu 1 ô explore để người dùng vẫn gặp bài ngoài gu. */
export const exploreSlots = (limit: number) => (limit < 2 ? 0 : Math.max(1, Math.round(limit * EXPLORE_RATE)));

const hash = (s: string) => createHash('md5').update(s).digest().readUInt32BE(0);

/**
 * Chọn bài explore tất định: sắp pool theo băm(userKey + postId + ngày), bỏ `skip` bài đầu (trang trước đã lấy).
 * Không Math.random: cùng người, cùng ngày thì cùng kết quả, đo lại được.
 */
export function pickExplore(pool: Candidate[], seed: { userKey: string; day: string }, count: number, skip = 0): RankedItem[] {
  if (count <= 0) return [];
  return pool
    .map((c) => ({ c, h: hash(`${seed.userKey}|${c.postId}|${seed.day}`) }))
    .sort((a, b) => a.h - b.h || a.c.postId.localeCompare(b.c.postId))
    .slice(skip, skip + count)
    .map(({ c }) => ({
      postId: c.postId,
      authorId: c.authorId,
      score: round4(c.score),
      source: 'explore' as const,
      breakdown: { hot: round4(c.score) },
      reason: { code: 'explore', text: 'Khám phá thêm' },
    }));
}

/** Chèn bài explore vào các vị trí cách đều trong trang; thiếu bài xếp hạng thì explore vẫn giữ chỗ của nó. */
export function interleave(ranked: RankedItem[], explore: RankedItem[], limit: number): RankedItem[] {
  const page = ranked.slice(0, limit - explore.length);
  explore.forEach((e, k) => {
    const at = Math.min(page.length, Math.floor(((k + 0.5) * limit) / explore.length));
    page.splice(at, 0, e);
  });
  return page;
}

const TASTE_PLACES = 3;
const TASTE_TAGS = 5;
/** Trọng số gu tối thiểu: thấp hơn là nhiễu một lần xem, không đáng mở nguồn riêng. */
const TASTE_MIN_WEIGHT = 0.2;

/** Khoá nặng nhất, bỏ tiền tố ngăn (`place:da-lat` → `da-lat`). */
const topKeys = (v: unknown, n: number, prefix = ''): string[] =>
  v && typeof v === 'object'
    ? Object.entries(v as Record<string, unknown>)
        .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] >= TASTE_MIN_WEIGHT)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, n)
        .map(([k]) => (prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k))
    : [];

/**
 * Nơi và tag/trải nghiệm người xem thích nhất; không có gu thì null. Đọc hai dạng hồ sơ:
 * tag_affinity@v0 (`places`, `tags`) và trip_profile@v1 (`answers.place` `place:<id>`, `answers.exp` `exp:<chủ đề>`).
 */
export function tasteOf(features: Record<string, unknown> | null): { places: string[]; tags: string[] } | null {
  const answers = (features?.answers ?? null) as Record<string, unknown> | null;
  const places = answers ? topKeys(answers.place, TASTE_PLACES, 'place:') : topKeys(features?.places, TASTE_PLACES);
  const tags = answers ? topKeys(answers.exp, TASTE_TAGS, 'exp:') : topKeys(features?.tags, TASTE_TAGS);
  return places.length || tags.length ? { places, tags } : null;
}
