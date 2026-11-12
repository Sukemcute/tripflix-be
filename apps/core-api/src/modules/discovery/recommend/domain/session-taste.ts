import { round4, type PostMeta } from './contracts.js';

/** Một bài vừa tương tác góp tối đa 0,5 vào tag/nơi của nó, giảm một nửa mỗi 30 phút: phản hồi ngay nhưng không thiên lệch lâu. */
const SESSION_WEIGHT = 0.5;
const HALF_LIFE_MS = 30 * 60_000;

const weightMap = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, w]) => typeof w === 'number')) : {};

/**
 * Cộng gu trong phiên vào gu dài hạn (dạng tag_affinity@v0: tags, places trong [0, 1]), chặn ở 1.
 * Không gộp vào bảng gu: job 10 phút vẫn là nguồn chuẩn.
 */
export function blendSessionTaste(
  features: Record<string, unknown> | null,
  recent: Array<{ meta: PostMeta; at: number }>,
  now: number,
): Record<string, unknown> | null {
  if (!recent.length) return features;
  const tags = weightMap(features?.tags);
  const places = weightMap(features?.places);
  const bump = (m: Record<string, number>, k: string, w: number) => (m[k] = round4(Math.min(1, (m[k] ?? 0) + w)));
  for (const { meta, at } of recent) {
    const w = SESSION_WEIGHT * 0.5 ** (Math.max(0, now - at) / HALF_LIFE_MS);
    for (const t of meta.tags) {
      const tag = t.trim().toLowerCase();
      if (tag) bump(tags, tag, w);
    }
    if (meta.placeId) bump(places, meta.placeId, w);
  }
  return { ...features, tags, places };
}
