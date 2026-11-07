import { Inject, Injectable } from '@nestjs/common';
import { CommerceFacade } from '../../../commerce/index.js';
import { pickHomeRecommendations, type HomeCandidate, type HomeDestinationPick } from '../domain/home-picks.js';

/** Phần của CommerceFacade mà luồng này dùng; test truyền bản giả. */
export type HomeCommerce = Pick<CommerceFacade, 'listCatalog'>;

/** Danh mục đổi chậm (seed, admin sửa giá): đọc lại sau mỗi chừng này thời gian. */
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_PAGE_SIZE = 200;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 50;

@Injectable()
export class HomeRecommendationUseCases {
  private cache: { loadedAt: number; candidates: HomeCandidate[] } | null = null;
  constructor(@Inject(CommerceFacade) private readonly commerce: HomeCommerce) {}

  async recommendForHome(query: { recentPlaceIds: readonly string[]; limit: number }): Promise<HomeDestinationPick[]> {
    return pickHomeRecommendations(await this.loadCandidates(), query.recentPlaceIds, query.limit);
  }

  /** ponytail: cache trong bộ nhớ từng tiến trình, đủ cho một bản core-api; nhiều bản thì mỗi bản tự đọc lại. */
  private async loadCandidates(): Promise<HomeCandidate[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < CATALOG_TTL_MS) return this.cache.candidates;
    const candidates: HomeCandidate[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      const result = await this.commerce.listCatalog({ type: 'hotel', cursor, limit: CATALOG_PAGE_SIZE, days: 30 });
      for (const item of result.items) {
        if (item.type !== 'hotel' || item.priceFrom === null) continue;
        const { id, name, thumbnail, stars, brand, province, priceFrom } = item;
        candidates.push({ hotelId: id, name, thumbnail, stars, brand, province, priceFrom });
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    this.cache = { loadedAt: Date.now(), candidates };
    return candidates;
  }
}
