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
  name: string;
  subtitle: string | null;
  placeId: string | null;
}

/** Lấy dư rồi chia theo hạn mức mỗi loại. */
const CANDIDATE_LIMIT = 40;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 1_000;

const toSuggestion = ({ id, type, refId, name, subtitle, placeId }: SuggestEntity): Suggestion => ({
  id,
  type,
  refId,
  name,
  subtitle,
  placeId,
});

@Injectable()
export class SuggestUseCases {
  constructor(
    @Inject(SUGGEST_STORE) private readonly store: SuggestStore,
    @Inject(HOTEL_CATALOG) private readonly catalog: HotelCatalog,
  ) {}

  /** Gợi ý khi gõ ở ô tìm OTA. Câu chỉ có ký tự lạ thì trả rỗng, không quét bảng. */
  async suggest({ q, types }: SuggestQuery): Promise<Suggestion[]> {
    const normalizedQuery = normalizeText(q);
    if (normalizedQuery.length < 2) return [];
    const candidates = await this.store.findCandidates(normalizedQuery, types, CANDIDATE_LIMIT);
    return pickSuggestions(candidates, SUGGEST_LIMIT).map(toSuggestion);
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
    return entities.length;
  }
}
