import { Inject, Injectable } from '@nestjs/common';
import { CommerceFacade } from '../../../commerce/index.js';
import { pickHomeRecommendations, type HomeCandidate, type HomeDestinationPick } from '../domain/home-picks.js';

/** Phần của CommerceFacade mà luồng này dùng; test truyền bản giả. */
export type HomeCommerce = Pick<CommerceFacade, 'listCatalog'>;

/** Danh mục đổi chậm (seed, admin sửa giá): đọc lại sau mỗi chừng này thời gian. */
const CATALOG_TTL_MS = 10 * 60_000;
/**
 * Tuổi tối đa của danh mục cũ còn được trả khi đang đọc lại ở nền. Quá mức này thì request phải chờ đọc mới
 * (lỗi thì báo lỗi), để không gợi ý mãi khách sạn đã hết phòng khi nguồn dữ liệu hỏng kéo dài.
 */
const CATALOG_MAX_STALE_MS = 30 * 60_000;
const CATALOG_PAGE_SIZE = 200;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 50;

/** Số kiểu truy vấn (nơi vừa tìm, limit) nhớ kết quả cùng lúc; quá thì xoá hết, tránh phình bộ nhớ vì tham số lạ. */
const MAX_REMEMBERED_PICKS = 500;

@Injectable()
export class HomeRecommendationUseCases {
  private cache: { loadedAt: number; candidates: HomeCandidate[] } | null = null;
  /** Lần đọc danh mục đang chạy: request tới cùng lúc chờ chung, không mỗi request đọc lại cả danh mục. */
  private loading: Promise<HomeCandidate[]> | null = null;
  /** Kết quả chỉ phụ thuộc danh mục và tham số, nên nhớ lại tới lần đọc danh mục sau (tính trung vị tốn ~10 ms CPU). */
  private readonly picks = new Map<string, HomeDestinationPick[]>();
  constructor(@Inject(CommerceFacade) private readonly commerce: HomeCommerce) {}

  async recommendForHome(query: { recentPlaceIds: readonly string[]; limit: number }): Promise<HomeDestinationPick[]> {
    const candidates = await this.loadCandidates();
    const key = `${query.limit}|${query.recentPlaceIds.join(',')}`;
    const remembered = this.picks.get(key);
    if (remembered) return remembered;
    const picks = pickHomeRecommendations(candidates, query.recentPlaceIds, query.limit);
    if (this.picks.size >= MAX_REMEMBERED_PICKS) this.picks.clear();
    this.picks.set(key, picks);
    return picks;
  }

  /**
   * ponytail: cache trong bộ nhớ từng tiến trình, đủ cho một bản core-api; nhiều bản thì mỗi bản tự đọc lại.
   * Hết hạn thì vẫn trả danh mục cũ ngay và đọc lại ở nền, để không request nào phải chờ cả lần đọc.
   * Danh mục cũ quá CATALOG_MAX_STALE_MS thì không dùng nữa: request chờ đọc mới, đọc lỗi thì báo lỗi.
   */
  private async loadCandidates(): Promise<HomeCandidate[]> {
    const age = this.cache ? Date.now() - this.cache.loadedAt : Infinity;
    if (this.cache && age < CATALOG_TTL_MS) return this.cache.candidates;
    const refresh = this.refreshCandidates();
    if (this.cache && age < CATALOG_MAX_STALE_MS) {
      // Đọc lại lỗi thì tạm giữ danh mục cũ; request sau sẽ thử lại.
      refresh.catch(() => undefined);
      return this.cache.candidates;
    }
    return refresh;
  }

  private refreshCandidates(): Promise<HomeCandidate[]> {
    this.loading ??= this.readCatalog()
      .then((candidates) => {
        this.cache = { loadedAt: Date.now(), candidates };
        this.picks.clear();
        return candidates;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async readCatalog(): Promise<HomeCandidate[]> {
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
    return candidates;
  }
}
