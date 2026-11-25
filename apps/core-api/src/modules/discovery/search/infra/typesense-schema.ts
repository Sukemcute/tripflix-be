import { createHash } from 'node:crypto';
import { LEXICON_ROWS } from '../domain/explore/lexicon-rows.js';
import type { TypesenseCollectionSchema, TypesenseSynonymPayload } from './typesense.client.js';

export interface ExploreSynonymDefinition {
  id: string;
  payload: TypesenseSynonymPayload;
}

/** Schema collection `explore_vN` trên Typesense (Phase 1–4: Lexical tiếng Việt + Geo + Facets, chưa dùng Vector). */
export function buildExploreCollectionSchema(collectionName: string): TypesenseCollectionSchema {
  return {
    name: collectionName,
    fields: [
      { name: 'id', type: 'string' },
      { name: 'vertical', type: 'string', facet: true },
      { name: 'kind', type: 'string', facet: true },
      { name: 'sections', type: 'string[]', facet: true },
      { name: 'ord', type: 'int32' },

      { name: 'title_vi', type: 'string', locale: 'vi' },
      { name: 'title_folded', type: 'string' },
      { name: 'body_vi', type: 'string', locale: 'vi', optional: true },
      { name: 'body_folded', type: 'string', optional: true },
      { name: 'streets_vi', type: 'string[]', locale: 'vi', optional: true },
      { name: 'streets_folded', type: 'string[]', facet: true, optional: true },
      { name: 'tags_folded', type: 'string[]', facet: true, optional: true },
      { name: 'abbrs', type: 'string[]', facet: true, optional: true },
      // Toàn bộ token đã chuẩn hoá của IndexedDoc.tf để lọc ứng viên (placeTerms, concept, bigram) khớp 100% với isCandidate().
      { name: 'terms', type: 'string[]', facet: true, optional: true },

      { name: 'place', type: 'string', facet: true, optional: true },
      { name: 'place_buckets', type: 'string[]', facet: true, optional: true },
      { name: 'has_place', type: 'bool', facet: true },
      // Ngăn recommend (bins.ts) cho nguồn gu: nơi suy từ 7 nguồn (cả khách sạn, hashtag), chủ đề exp.
      { name: 'place_bins', type: 'string[]', facet: true, optional: true },
      { name: 'exp_bins', type: 'string[]', facet: true, optional: true },
      { name: 'location', type: 'geopoint', optional: true },

      { name: 'price_from', type: 'int64', facet: true, optional: true },
      { name: 'has_price', type: 'bool', facet: true },
      { name: 'days', type: 'int32', facet: true, optional: true },
      { name: 'stars', type: 'float', facet: true, optional: true },
      { name: 'tier', type: 'string', facet: true, optional: true },
      { name: 'brand', type: 'string', facet: true, optional: true },

      { name: 'quality_score', type: 'float' },
      { name: 'created_at', type: 'int64' },

      // Lưu snapshot IndexedDoc để stage 2 chấm chính xác ACCENT_MISS / coverage / reason trên Top-K ứng viên.
      { name: 'doc_json', type: 'string', index: false },
      // Băm nội dung (bỏ `ord`) để lượt đối soát chỉ ghi mục mới/đổi.
      { name: 'content_hash', type: 'string', index: false, optional: true },
    ],
    default_sorting_field: 'quality_score',
  };
}

/** Đổi schema thì đổi phiên bản: lượt đối soát kế tiếp dựng collection mới và đổi alias thay vì ghi đè. */
export const EXPLORE_SCHEMA_VERSION = createHash('sha1')
  .update(JSON.stringify(buildExploreCollectionSchema('x').fields))
  .digest('hex')
  .slice(0, 8);

const slugId = (s: string): string => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'item';

/** Sinh bộ Synonyms cho Typesense từ LEXICON_ROWS (norm -> one-way, concept/mod -> multi-way). */
export function buildExploreSynonyms(): ExploreSynonymDefinition[] {
  const normByBucket = new Map<string, Set<string>>();
  const conceptByBucket = new Map<string, Set<string>>();

  for (const [type, bucket, term] of LEXICON_ROWS) {
    if (term.length < 2) continue;
    if (type === 'norm') {
      if (bucket.length < 2 || term === bucket) continue;
      const set = normByBucket.get(bucket) ?? new Set<string>();
      set.add(term);
      normByBucket.set(bucket, set);
    } else if (type === 'concept' || type === 'mod') {
      const set = conceptByBucket.get(bucket) ?? new Set<string>();
      set.add(term);
      conceptByBucket.set(bucket, set);
    }
  }

  const out: ExploreSynonymDefinition[] = [];
  const usedIds = new Set<string>();
  const nextId = (prefix: string, bucket: string): string => {
    const base = `${prefix}_${slugId(bucket)}`;
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}_${i++}`;
    usedIds.add(id);
    return id;
  };

  for (const [bucket, terms] of normByBucket) {
    if (!terms.size) continue;
    out.push({
      id: nextId('norm', bucket),
      payload: { root: bucket, synonyms: [...terms] },
    });
  }

  for (const [bucket, terms] of conceptByBucket) {
    if (terms.size < 2) continue;
    out.push({
      id: nextId('concept', bucket),
      payload: { synonyms: [...terms] },
    });
  }

  return out;
}
