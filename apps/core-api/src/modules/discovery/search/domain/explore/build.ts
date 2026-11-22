// Dựng chỉ mục từ danh sách object: tài liệu từng nhánh + mọi bộ đếm (df, cụm, tên riêng, tâm nơi).
// Port từ Engine.add / Index.add của prototype. Dựng lại toàn bộ mỗi lần (xem job), nên không cần cộng/trừ từng object.
import { NS } from './stats.js';
import { abbrs, accWords, brandOf, isVi, objTier, statParts, streetsOf, titleGrams, toks } from './text.js';
import type { BuiltIndex, CountRow, ExploreKind, ExploreObject, IndexedDoc } from './types.js';

/** Nhánh nhận loại object nào. */
export const VERTICAL_OF: Record<ExploreKind, string> = {
  food: 'eats',
  cafe: 'eats',
  stay: 'stays',
  see: 'sights',
  video: 'videos',
  plan: 'plans',
  post: 'plans',
};

class Counter extends Map<string, number> {
  add(key: string, n = 1) {
    this.set(key, (this.get(key) ?? 0) + n);
  }
}

export function indexDoc(o: ExploreObject, vertical: string, ord: number): IndexedDoc {
  const tf = new Counter();
  const titleToks = toks(o.title);
  for (const t of [...titleToks, ...titleToks, ...titleToks, ...toks(o.text ?? '')]) tf.add(t); // tên nặng gấp 3
  // Viết tắt của tên + nơi chốn, không lấy review.
  for (const t of new Set([...abbrs(o.title), ...abbrs(`${o.area ?? ''} , ${o.addr ?? ''}`)])) tf.add(t);
  // Chỉ phần là tiếng Việt có dấu thật mới bắt đúng dấu; mô tả tiếng Anh lẫn 'Lăng Cô' -> so bản bỏ dấu.
  const acc = new Set([o.title, o.text ?? ''].filter(isVi).flatMap(accWords));
  return {
    id: o.id,
    vertical,
    ord,
    obj: o,
    tf: Object.fromEntries(tf),
    dl: [...tf.values()].reduce((a, b) => a + b, 0),
    acc: acc.size ? [...acc] : null,
    streets: streetsOf(o),
    tier: vertical === 'stays' ? objTier(o) : null,
  };
}

export function buildIndex(objects: readonly ExploreObject[]): BuiltIndex {
  // Cùng id: bản sau thay bản trước và xếp cuối (như sửa = xoá + thêm).
  const byId = new Map<string, ExploreObject>();
  for (const o of objects) {
    if (!VERTICAL_OF[o.kind]) continue;
    byId.delete(o.id);
    byId.set(o.id, o);
  }
  const counts = new Map<string, Counter>();
  const c = (ns: string) => counts.get(ns) ?? counts.set(ns, new Counter()).get(ns)!;
  const placeSum = new Map<string, [number, number, number]>();
  const brandPlaces = new Map<string, Set<string>>();
  const docs: IndexedDoc[] = [];

  for (const o of byId.values()) {
    const vertical = VERTICAL_OF[o.kind];
    const doc = indexDoc(o, vertical, docs.length);
    docs.push(doc);
    c(NS.docs).add(vertical);
    c(NS.len).add(vertical, doc.dl);
    for (const t of Object.keys(doc.tf)) {
      c(NS.dfOf(vertical)).add(t);
      c(NS.df).add(t);
    }
    for (const ws of statParts(o)) {
      for (let k = 1; k <= 3; k++) {
        for (let i = 0; i + k <= ws.length; i++) c(NS.ngram).add(ws.slice(i, i + k).join(' '));
        c(NS.ngramTotal).add(String(k), Math.max(0, ws.length - k + 1));
      }
    }
    if (o.place && o.lat != null && o.lon != null) {
      const p = placeSum.get(o.place) ?? [0, 0, 0];
      placeSum.set(o.place, [p[0] + o.lat, p[1] + o.lon, p[2] + 1]);
    }
    for (const s of doc.streets) c(NS.street).add(s);
    for (const g of titleGrams(o.title)) c(NS.titleGram).add(g);
    const brand = brandOf(o.title, doc.streets);
    if (brand) {
      c(NS.brand).add(brand);
      const places = brandPlaces.get(brand) ?? new Set<string>();
      places.add(String(o.place || o.area || null));
      brandPlaces.set(brand, places);
    }
  }
  for (const [b, places] of brandPlaces) c(NS.brandPlaces).set(b, places.size);
  for (const [place, [lat, lon, n]] of placeSum) {
    c(NS.centerLat).set(place, lat / n);
    c(NS.centerLon).set(place, lon / n);
  }
  const rows: CountRow[] = [];
  for (const [ns, counter] of counts) for (const [key, n] of counter) if (n) rows.push({ ns, key, n });
  return { docs, counts: rows };
}
