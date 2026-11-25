import { createHash } from 'node:crypto';
import { placeParentOf } from '../../search/domain/places.js';
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
/**
 * Gu tối thiểu, tính theo tỉ lệ trên mục nặng nhất: tag_affinity chuẩn hoá [0, 1] còn trip_profile lưu tổng thô
 * (đo 25/11: tới 21), ngưỡng tuyệt đối không lọc được gì.
 */
const TASTE_MIN_SHARE = 0.2;

/** Khoá nặng nhất (đã bỏ tiền tố ngăn `place:da-lat` → `da-lat`), bỏ khoá nhẹ hơn TASTE_MIN_SHARE × khoá nặng nhất. */
function topKeys(v: unknown, n: number, prefix = '', drop: (key: string, all: ReadonlySet<string>) => boolean = () => false): string[] {
  if (!v || typeof v !== 'object') return [];
  const entries = Object.entries(v as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
    .map(([k, w]) => [prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k, w] as const);
  const max = Math.max(0, ...entries.map(([, w]) => w));
  const all = new Set(entries.map(([k]) => k));
  return entries
    .filter(([k, w]) => w >= TASTE_MIN_SHARE * max && !drop(k, all))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

/** Tỉnh cha có cùng điểm với nơi con (trip_profile cộng cả hai): giữ nơi con, chỗ còn lại cho nơi khác. */
const isParentOfAnother = (id: string, all: ReadonlySet<string>) => [...all].some((other) => placeParentOf(other) === id);

/**
 * Nơi và tag/trải nghiệm người xem thích nhất; không có gu thì null. Đọc hai dạng hồ sơ:
 * tag_affinity@v0 (`places`, `tags`) và trip_profile@v1 (`answers.place` `place:<id>`, `answers.exp` `exp:<chủ đề>`).
 */
export function tasteOf(features: Record<string, unknown> | null): { places: string[]; tags: string[] } | null {
  const answers = (features?.answers ?? null) as Record<string, unknown> | null;
  const places = answers ? topKeys(answers.place, TASTE_PLACES, 'place:', isParentOfAnother) : topKeys(features?.places, TASTE_PLACES, '', isParentOfAnother);
  const tags = answers ? topKeys(answers.exp, TASTE_TAGS, 'exp:') : topKeys(features?.tags, TASTE_TAGS);
  return places.length || tags.length ? { places, tags } : null;
}
