import type { HotelSummary, SuggestEntity, SuggestType } from '../domain/suggest-entity.js';

export const SUGGEST_STORE = Symbol('SUGGEST_STORE');
export const HOTEL_CATALOG = Symbol('HOTEL_CATALOG');

export interface SuggestStore {
  /** Ứng viên khớp `normalizedQuery`, xếp sẵn: khớp đầu từ trước, rồi độ giống, rồi độ nổi tiếng. */
  findCandidates(normalizedQuery: string, types: readonly SuggestType[], limit: number): Promise<SuggestEntity[]>;
  /** Thay toàn bộ chỉ mục trong một transaction, người đang tìm không thấy bảng rỗng. */
  replaceAll(entities: readonly SuggestEntity[]): Promise<void>;
}

/** Nguồn danh mục khách sạn, đọc theo trang. Thật: CommerceFacade.listCatalog. */
export interface HotelCatalog {
  listHotels(cursor: string | null): Promise<{ items: HotelSummary[]; nextCursor: string | null }>;
}
