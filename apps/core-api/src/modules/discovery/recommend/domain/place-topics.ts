/**
 * Hồ sơ chủ đề của từng nơi, nối từ dữ liệu sẵn có thay cho bảng gõ tay (19/11):
 * kiểu khách sạn của commerce ở nơi đó (Đà Lạt 60/76 "núi", Quy Nhơn 16/29 "biển"). Chỉ nối từ vựng kiểu khách sạn
 * sang ngăn; "thành phố", "homestay", "boutique" không nói lên chủ đề nên bỏ.
 */
export const STYLE_EXPS: Readonly<Record<string, string>> = { 'biển': 'exp:bien', 'núi': 'exp:nui', resort: 'exp:nghi_duong' };

/** Nơi có ít khách sạn hơn thì chưa đủ để nói nơi đó thiên về gì. */
const MIN_PLACE_HOTELS = 5;

/**
 * 'place:<id>' → ngăn → độ vượt trội: tỉ lệ khách sạn kiểu đó ở nơi này trừ tỉ lệ chung của cả kho, chỉ giữ phần dương.
 * Phú Quốc nhiều resort hơn mặt bằng thì được nghỉ dưỡng; Hà Nội gần như toàn "thành phố" thì không có ngăn nào.
 */
export function placeStyleProfiles(counts: ReadonlyArray<{ placeId: string; style: string; hotels: number }>): Map<string, Record<string, number>> {
  const perPlace = new Map<string, { total: number; exps: Record<string, number> }>();
  const all: Record<string, number> = {};
  let allTotal = 0;
  for (const { placeId, style, hotels } of counts) {
    const p = perPlace.get(placeId) ?? { total: 0, exps: {} };
    p.total += hotels;
    allTotal += hotels;
    const exp = STYLE_EXPS[style.trim().toLowerCase()];
    if (exp) {
      p.exps[exp] = (p.exps[exp] ?? 0) + hotels;
      all[exp] = (all[exp] ?? 0) + hotels;
    }
    perPlace.set(placeId, p);
  }
  const out = new Map<string, Record<string, number>>();
  for (const [placeId, p] of perPlace) {
    if (p.total < MIN_PLACE_HOTELS || allTotal === 0) continue;
    const lift = Object.fromEntries(
      Object.entries(p.exps)
        .map(([e, n]) => [e, n / p.total - (all[e] ?? 0) / allTotal] as const)
        .filter(([, d]) => d > 0),
    );
    if (Object.keys(lift).length) out.set(`place:${placeId}`, lift);
  }
  return out;
}
