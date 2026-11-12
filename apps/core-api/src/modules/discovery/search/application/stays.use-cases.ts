import { Inject, Injectable } from '@nestjs/common';
import { CommerceFacade, type CatalogHotel } from '../../../commerce/index.js';
import { filterAndSortStays, paginate, resolvePlaceSlugs, type StayFilter, type StayResult, type StaySort } from '../domain/stays.js';

export interface ListStaysQuery extends StayFilter {
  placeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms?: number;
  sort: StaySort;
  cursor?: string;
  limit: number;
}

export interface StayPage {
  items: StayResult[];
  /** Số khách sạn còn phòng khớp bộ lọc, trên mọi trang. */
  total: number;
  nextCursor: string | null;
}

/** Phần của CommerceFacade mà luồng này dùng; test truyền bản giả. */
export type StayCommerce = Pick<CommerceFacade, 'listCatalog' | 'checkAvailability'>;

/** Giới hạn của commerce.listCatalog và checkAvailability. */
const CATALOG_PAGE_SIZE = 200;
const AVAILABILITY_BATCH_SIZE = 100;
/** Chặn vòng lặp nếu nguồn trả con trỏ lặp lại. */
const MAX_CATALOG_PAGES = 50;

@Injectable()
export class StaysUseCases {
  constructor(@Inject(CommerceFacade) private readonly commerce: StayCommerce) {}

  /**
   * Khách sạn còn phòng ở một nơi cho ngày đã chọn (trang kết quả web OTA). Không phải tìm kiếm: lấy hết khách sạn của nơi đó
   * từ commerce, hỏi commerce còn phòng và giá thật, bỏ chỗ hết phòng rồi lọc, sắp, cắt trang. Nơi lạ thì null.
   * Ngày, số khách sai thì commerce ném CommerceError('invalid_query').
   */
  async listStays(query: ListStaysQuery): Promise<StayPage | null> {
    const slugs = resolvePlaceSlugs(query.placeId);
    if (!slugs) return null;

    const hotels = (await Promise.all(slugs.map((slug) => this.listHotelsIn(slug)))).flat();
    if (!hotels.length) return { items: [], total: 0, nextCursor: null };

    const batches: CatalogHotel[][] = [];
    for (let i = 0; i < hotels.length; i += AVAILABILITY_BATCH_SIZE) batches.push(hotels.slice(i, i + AVAILABILITY_BATCH_SIZE));
    const availability = (
      await Promise.all(
        batches.map((batch) =>
          this.commerce.checkAvailability({
            productIds: batch.map((h) => h.id),
            checkIn: query.checkIn,
            checkOut: query.checkOut,
            adults: query.adults,
            rooms: query.rooms,
          }),
        ),
      )
    ).flat();
    const byId = new Map(availability.map((a) => [a.productId, a]));

    const available = hotels.flatMap((h): StayResult[] => {
      const a = byId.get(h.id);
      if (!a?.isAvailable || a.unitPrice === null || a.totalPrice === null) return [];
      return [
        { hotelId: h.id, name: h.name, stars: h.stars, thumbnail: h.thumbnail, province: h.province, unitPrice: a.unitPrice, totalPrice: a.totalPrice, rating: h.rating ?? null },
      ];
    });
    const ranked = filterAndSortStays(available, query, query.sort);
    return { ...paginate(ranked, query.cursor, query.limit), total: ranked.length };
  }

  private async listHotelsIn(provinceSlug: string): Promise<CatalogHotel[]> {
    const hotels: CatalogHotel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
      // days: 1 vì luồng này không dùng priceFrom của danh mục, chỉ cần tên, sao, ảnh; giá thật lấy từ checkAvailability.
      const result = await this.commerce.listCatalog({ type: 'hotel', provinceSlug, cursor, limit: CATALOG_PAGE_SIZE, days: 1 });
      hotels.push(...result.items.filter((item): item is CatalogHotel => item.type === 'hotel'));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return hotels;
  }
}
