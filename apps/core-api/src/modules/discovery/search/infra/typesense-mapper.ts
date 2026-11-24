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
  hot_score: number;
  likes: number;
  comments: number;
  created_at: number;
  is_hidden: boolean;
  doc_json: string;
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
export function indexedDocToTypesenseDoc(doc: IndexedDoc, hotScore = 0): TypesenseExploreDoc {
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
    hot_score: Number.isFinite(hotScore) ? hotScore : 0,
    likes: typeof o.likes === 'number' && Number.isFinite(o.likes) ? Math.trunc(o.likes) : 0,
    comments: typeof o.n === 'number' && Number.isFinite(o.n) ? Math.trunc(o.n) : 0,
    created_at: Number.isFinite(createdMs) ? Math.trunc(createdMs) : 0,
    is_hidden: false,
    doc_json: JSON.stringify(doc),
  };
}

/** Khôi phục IndexedDoc từ Typesense kèm overlay các chỉ số tương tác mới nhất (likes, comments, hotScore). */
export function typesenseDocToIndexedDoc(raw: TypesenseExploreDoc): { doc: IndexedDoc; hotScore: number } {
  const doc = JSON.parse(raw.doc_json) as IndexedDoc;
  if (typeof raw.likes === 'number' && typeof doc.obj.likes === 'number') doc.obj.likes = raw.likes;
  if (typeof raw.comments === 'number' && typeof doc.obj.n === 'number') doc.obj.n = raw.comments;
  return {
    doc,
    hotScore: typeof raw.hot_score === 'number' && Number.isFinite(raw.hot_score) ? raw.hot_score : 0,
  };
}
