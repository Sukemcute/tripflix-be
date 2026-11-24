import { createHash } from 'node:crypto';
import { bucketsWithin, placeBucketOfId, placeIdOfName, placeParentOf } from '../domain/places.js';
import { VERTICALS } from '../domain/explore/rank.js';
import { brandOf, fold } from '../domain/explore/text.js';
import type { IndexedDoc } from '../domain/explore/types.js';

export interface TypesenseExploreDoc {
  id: string;
  vertical: string;
  kind: string;
  sections: string[];
  ord: number;
  title_vi: string;
  title_folded: string;
  body_vi?: string;
  body_folded?: string;
  streets_vi?: string[];
  streets_folded?: string[];
  tags_folded?: string[];
  abbrs?: string[];
  terms?: string[];
  place?: string;
  place_buckets?: string[];
  has_place: boolean;
  location?: [number, number];
  price_from?: number;
  has_price: boolean;
  days?: number;
  stars?: number;
  tier?: string;
  brand?: string;
  quality_score: number;
  created_at: number;
  doc_json: string;
  content_hash?: string;
}

const VERTICAL_MAP = new Map(VERTICALS.map((v) => [v.name, v]));
const HASHTAG_RE = /#([\p{L}\p{N}_-]+)/gu;

function extractTagsFolded(doc: IndexedDoc): string[] {
  const tags = new Set<string>(doc.obj.topics ?? []);
  const text = doc.obj.text ?? '';
  for (const m of text.matchAll(HASHTAG_RE)) {
    const folded = fold(m[1]).trim();
    if (folded) tags.add(folded);
  }
  return [...tags];
}

function placeBucketsOf(place: string | null | undefined): string[] {
  if (!place) return [];
  const buckets = new Set<string>([place]);
  const pid = placeIdOfName(place);
  const parentId = pid ? placeParentOf(pid) : null;
  const parentBucket = parentId ? placeBucketOfId(parentId) : null;
  if (parentBucket && bucketsWithin(parentBucket).includes(place)) {
    buckets.add(parentBucket);
  }
  return [...buckets];
}

/** Chuyển IndexedDoc sang document phẳng lưu trên Typesense. */
export function indexedDocToTypesenseDoc(doc: IndexedDoc): TypesenseExploreDoc {
  const o = doc.obj;
  const vt = VERTICAL_MAP.get(doc.vertical);
  const qualityScore = vt ? vt.quality(o) : 0.35;
  const sections = vt ? vt.sections(o) : [o.kind];
  const rawPrice = vt?.price(o);
  const priceFrom = typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice > 0 ? Math.trunc(rawPrice) : undefined;
  const streetsVi = (o.addr ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tagsFolded = extractTagsFolded(doc);
  const abbrList = Object.keys(doc.tf)
    .filter((t) => t.startsWith('#'))
    .map((t) => t.slice(1));
  const termsList = Object.keys(doc.tf);
  const brand = brandOf(o.title, doc.streets) ?? undefined;
  const placeBuckets = placeBucketsOf(o.place);
  const createdMs = o.createdAt ? Date.parse(o.createdAt) : Number.NaN;
  const hasGeo = typeof o.lat === 'number' && Number.isFinite(o.lat) && typeof o.lon === 'number' && Number.isFinite(o.lon);
  const bodyText = o.text?.trim() || undefined;
  const bodyFolded = bodyText ? fold(bodyText).trim() || undefined : undefined;

  return {
    id: doc.id,
    vertical: doc.vertical,
    kind: o.kind,
    sections,
    ord: doc.ord,
    title_vi: o.title,
    title_folded: fold(o.title).trim(),
    ...(bodyText ? { body_vi: bodyText } : {}),
    ...(bodyFolded ? { body_folded: bodyFolded } : {}),
    ...(streetsVi.length ? { streets_vi: streetsVi } : {}),
    ...(doc.streets.length ? { streets_folded: doc.streets } : {}),
    ...(tagsFolded.length ? { tags_folded: tagsFolded } : {}),
    ...(abbrList.length ? { abbrs: abbrList } : {}),
    ...(termsList.length ? { terms: termsList } : {}),
    ...(o.place ? { place: o.place } : {}),
    ...(placeBuckets.length ? { place_buckets: placeBuckets } : {}),
    has_place: Boolean(o.place),
    ...(hasGeo ? { location: [o.lat!, o.lon!] } : {}),
    ...(priceFrom !== undefined ? { price_from: priceFrom } : {}),
    has_price: priceFrom !== undefined,
    ...(typeof o.days === 'number' && Number.isFinite(o.days) ? { days: Math.trunc(o.days) } : {}),
    ...(typeof o.stars === 'number' && Number.isFinite(o.stars) ? { stars: o.stars } : {}),
    ...(doc.tier ? { tier: doc.tier[0] } : {}),
    ...(brand ? { brand } : {}),
    quality_score: Number.isFinite(qualityScore) ? qualityScore : 0.35,
    created_at: Number.isFinite(createdMs) ? Math.trunc(createdMs) : 0,
    doc_json: JSON.stringify(doc),
  };
}

/**
 * Tài liệu kèm `content_hash`. Băm trên bản `ord = 0`: thêm một bài làm dời `ord` của mọi mục sau nó,
 * không được tính là "đổi" (ord chỉ để phá hoà khi bằng điểm; mục không đổi giữ ord cũ).
 */
export function toTypesenseDocWithHash(doc: IndexedDoc): TypesenseExploreDoc {
  const hash = createHash('sha1')
    .update(JSON.stringify(indexedDocToTypesenseDoc({ ...doc, ord: 0 })))
    .digest('hex');
  return { ...indexedDocToTypesenseDoc(doc), content_hash: hash };
}

/** Khôi phục IndexedDoc đã lưu lúc lập chỉ mục. Like, comment là số lúc lập chỉ mục (đối soát đêm hoặc sự kiện bài). */
export function typesenseDocToIndexedDoc(raw: TypesenseExploreDoc): IndexedDoc {
  return JSON.parse(raw.doc_json) as IndexedDoc;
}
