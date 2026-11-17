// F10 (TF39): phần dùng chung để chia gợi ý thành nhóm tiêu chí, mỗi mục kèm nhãn lý do. Hàm thuần.
// Khách sạn xếp bằng ranker trip_stays@v0, chuyến bay bằng trip_flights@v0 (rankers/).

export interface Badge<C extends string> {
  code: C;
  text: string;
}

export interface PickGroup<C extends string> {
  code: C;
  label: string;
  /** hotelId hoặc flightKey của các mục trong nhóm, tốt nhất trước. */
  ids: string[];
}

export interface Grouped<T, C extends string> {
  items: T[];
  groups: PickGroup<C>[];
}

export const formatVnd = (n: number) => `${new Intl.NumberFormat('vi-VN').format(n)}đ`;
export const formatKm = (value: number) => (value < 1 ? `${Math.max(50, Math.round((value * 1000) / 50) * 50)} m` : `${value.toFixed(1).replace('.', ',')} km`);

/** Gom các nhóm: mỗi nhóm lấy perGroup mục đầu; mỗi mục mang nhãn của mọi nhóm chứa nó, theo thứ tự nhóm. Nhóm rỗng thì bỏ. */
export function buildGroups<T, C extends string>(
  order: readonly C[],
  labels: Record<C, string>,
  ranked: Record<C, { item: T; text: string }[]>,
  idOf: (item: T) => string,
  perGroup: number,
): { picks: Map<string, { item: T; badges: Badge<C>[] }>; groups: PickGroup<C>[] } {
  const picks = new Map<string, { item: T; badges: Badge<C>[] }>();
  const groups: PickGroup<C>[] = [];
  for (const code of order) {
    const top = ranked[code].slice(0, perGroup);
    if (top.length === 0) continue;
    for (const { item, text } of top) {
      const id = idOf(item);
      const pick = picks.get(id) ?? { item, badges: [] };
      pick.badges.push({ code, text });
      picks.set(id, pick);
    }
    groups.push({ code, label: labels[code], ids: top.map(({ item }) => idOf(item)) });
  }
  return { picks, groups };
}
