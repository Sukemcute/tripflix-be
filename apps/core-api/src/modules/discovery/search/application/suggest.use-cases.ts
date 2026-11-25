import { Inject, Injectable } from '@nestjs/common';
import { normalizeText } from '../domain/normalize-text.js';
import {
  SUGGEST_LIMIT,
  buildSuggestEntities,
  pickSuggestions,
  type HotelSummary,
  type SuggestEntity,
  type SuggestType,
} from '../domain/suggest-entity.js';
import { HOTEL_CATALOG, SUGGEST_STORE, type HotelCatalog, type SuggestStore } from './ports.js';

export interface SuggestQuery {
  q: string;
  types: readonly SuggestType[];
}

export interface Suggestion {
  id: string;
  type: SuggestType;
  refId: string;
  /** hotel: mã trên URL trang chi tiết; dòng khác null. */
  slug: string | null;
  name: string;
  subtitle: string | null;
  placeId: string | null;
}

/** Lấy dư rồi chia theo hạn mức mỗi loại. */
const CANDIDATE_LIMIT = 40;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 1_000;

const toSuggestion = ({ id, type, refId, slug, name, subtitle, placeId }: SuggestEntity): Suggestion => ({
  id,
  type,
  refId,
  slug,
  name,
  subtitle,
  placeId,
});

/** Nhiều người gõ cùng tiền tố ("da", "nha t"): giữ kết quả ngắn hạn, mỗi lần gõ khỏi quét lại cả bảng gợi ý. */
export const SUGGEST_CACHE_TTL_MS = 60_000;
const SUGGEST_CACHE_MAX = 500;

@Injectable()
export class SuggestUseCases {
  private readonly cache = new Map<string, { at: number; items: Promise<Suggestion[]> }>();

  constructor(
    @Inject(SUGGEST_STORE) private readonly store: SuggestStore,
    @Inject(HOTEL_CATALOG) private readonly catalog: HotelCatalog,
  ) {}

  /** Gợi ý khi gõ ở ô tìm OTA. Câu chỉ có ký tự lạ thì trả rỗng, không quét bảng. */
  async suggest({ q, types }: SuggestQuery): Promise<Suggestion[]> {
    const normalizedQuery = normalizeText(q);
    if (normalizedQuery.length < 2) return [];
    const key = `${normalizedQuery}|${[...types].sort().join(',')}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < SUGGEST_CACHE_TTL_MS) return hit.items;
    const items = this.store
      .findCandidates(normalizedQuery, types, CANDIDATE_LIMIT)
      .then((candidates) => pickSuggestions(candidates, SUGGEST_LIMIT).map(toSuggestion));
    const entry = { at: Date.now(), items };
    this.cache.delete(key);
    this.cache.set(key, entry);
    // Map giữ thứ tự chèn: đầy thì bỏ mục cũ nhất.
    if (this.cache.size > SUGGEST_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    items.catch(() => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
    });
    return items;
  }

  /** Dựng lại toàn bộ chỉ mục gợi ý. Trả số dòng đã ghi. */
  async rebuildIndex(): Promise<number> {
    const hotels: HotelSummary[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const result = await this.catalog.listHotels(cursor);
      hotels.push(...result.items);
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    const entities = buildSuggestEntities(hotels);
    await this.store.replaceAll(entities);
    this.cache.clear();
    return entities.length;
  }
}
