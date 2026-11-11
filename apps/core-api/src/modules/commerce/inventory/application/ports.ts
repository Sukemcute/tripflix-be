import type { HotelDetails, RoomTypeDetails } from '../../db/schema/index.js';
import type { FlightDay, PricePlan, RoomDay } from '../domain/sales-rules.js';

export interface PropertyRecord {
  id: string;
  slug: string;
  name: string;
  provinceSlug: string;
  provinceName: string;
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  thumbnail: string | null;
  images: string[];
  // Thông tin trang chi tiết (TF10). Không bắt buộc: dữ liệu cũ và test dựng tay có thể chưa có.
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  ratingAvg?: number | null;
  reviewCount?: number;
  ratingSource?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  details?: HotelDetails;
}

export interface RoomTypeRecord {
  id: string;
  propertyId: string;
  name: string;
  maxGuests: number;
  defaultTotal: number;
  defaultPrice: number;
  ratePlans: PricePlan[];
  details?: RoomTypeDetails;
}

export interface FlightRecord {
  id: string;
  flightKey: string;
  name: string;
  airline: string | null;
  airlineCode?: string | null;
  flightNumber?: string | null;
  stops?: number;
  cabinCode?: string;
  fromAirport: string;
  toAirport: string;
  departTime: string | null;
  arriveTime: string | null;
  destinationSlug: string;
  destinationName: string;
  cabinName: string;
  defaultSeats: number;
  defaultPrice: number;
  farePlans: PricePlan[];
}

/** Ngày mới cần mở bán; ngày đã có thì giữ nguyên (không ghi đè số đã giữ, đã bán hay giá admin đã sửa). */
export interface NewRoomDay extends Omit<RoomDay, 'held' | 'sold'> {
  roomTypeId: string;
}
export interface NewFlightDay extends Omit<FlightDay, 'held' | 'sold'> {
  flightId: string;
}

export interface CatalogRepository {
  /** Khách sạn theo id tăng dần, sau afterId (phân trang theo con trỏ). */
  listProperties(filter: { provinceSlug?: string; afterId?: string; limit: number }): Promise<PropertyRecord[]>;
  findPropertyById(id: string): Promise<PropertyRecord | null>;
  /** Tìm theo slug; tạm nhận cả id cũ để app bản cũ không gãy (TF66). */
  findPropertyBySlugOrId(slugOrId: string): Promise<PropertyRecord | null>;
  findRoomTypesByPropertyIds(propertyIds: string[]): Promise<RoomTypeRecord[]>;
  findRoomTypesByIds(ids: string[]): Promise<RoomTypeRecord[]>;
  /** Các chuyến (theo flight_key tăng dần, sau afterKey) cùng mọi hạng ghế của chuyến đó. */
  listFlights(filter: { destinationSlug?: string; afterKey?: string; limit: number }): Promise<FlightRecord[]>;
  findFlightsByIds(ids: string[]): Promise<FlightRecord[]>;
  findFlightsByKeys(flightKeys: string[]): Promise<FlightRecord[]>;
  /** Mọi hạng ghế của các chuyến bay đúng tuyến (mã sân bay đi, đến). */
  findFlightsByRoute(fromAirport: string, toAirport: string): Promise<FlightRecord[]>;
  /** Các tuyến đang có chuyến, kèm số chuyến (không đếm trùng hạng ghế). */
  listFlightRoutes(): Promise<FlightRouteRecord[]>;
}

export interface FlightRouteRecord {
  fromAirport: string;
  toAirport: string;
  destinationSlug: string;
  destinationName: string;
  flightCount: number;
}

export interface CalendarRepository {
  /** Lịch phòng từ from tới toInclusive của nhiều loại phòng trong một lần đọc. */
  loadRoomDays(roomTypeIds: string[], from: string, toInclusive: string): Promise<Map<string, RoomDay[]>>;
  loadFlightDays(flightIds: string[], from: string, toInclusive: string): Promise<Map<string, FlightDay[]>>;
  /** Ngày xa nhất đã mở bán của từng loại phòng / hạng ghế. */
  findLastOpenedRoomDates(): Promise<Map<string, string>>;
  findLastOpenedFlightDates(): Promise<Map<string, string>>;
  /** Chèn ngày mới, bỏ qua ngày đã có. Trả số dòng thực sự chèn. */
  insertRoomDays(days: NewRoomDay[]): Promise<number>;
  insertFlightDays(days: NewFlightDay[]): Promise<number>;
  listAllRoomTypes(): Promise<(RoomTypeRecord & { stars: number | null })[]>;
  listAllFlights(): Promise<FlightRecord[]>;
}

/** Các trường admin được sửa trên lịch phòng; trường bỏ trống thì giữ nguyên. */
export interface RoomCalendarPatch {
  total?: number;
  price?: number;
  isStopSell?: boolean;
  isClosedToArrival?: boolean;
  isClosedToDeparture?: boolean;
  minLos?: number;
  maxLos?: number;
}
export interface FlightCalendarPatch {
  total?: number;
  price?: number;
  isStopSell?: boolean;
}

export interface CalendarAdminRepository {
  /** Số ngày đã mở bán trong khoảng, để biết lệnh sửa có phủ đủ không. */
  countRoomDays(roomTypeId: string, from: string, toInclusive: string): Promise<number>;
  countFlightDays(flightId: string, from: string, toInclusive: string): Promise<number>;
  /**
   * Cập nhật có điều kiện cả khoảng ngày (UPDATE ... WHERE), không đọc rồi ghi. Đổi total thì chỉ cập nhật ngày
   * có held + sold <= total mới. Trả số ngày đã cập nhật; ít hơn số ngày trong khoảng nghĩa là có ngày vi phạm.
   */
  updateRoomDays(roomTypeId: string, from: string, toInclusive: string, patch: RoomCalendarPatch): Promise<number>;
  updateFlightDays(flightId: string, from: string, toInclusive: string, patch: FlightCalendarPatch): Promise<number>;
  /** Ngày có held + sold > total đề xuất: để báo admin vì sao không giảm được. */
  findOverbookedRoomDates(roomTypeId: string, from: string, toInclusive: string, total: number): Promise<string[]>;
  findOverbookedFlightDates(flightId: string, from: string, toInclusive: string, total: number): Promise<string[]>;
  insertAuditLog(entry: { actorUserId: string; action: string; entityType: 'room_type' | 'flight'; entityId: string; changes: Record<string, unknown> }): Promise<void>;
}

/** Đánh giá đã công khai (status = published). createdAt dạng ISO. */
export interface ReviewRecord {
  id: string;
  propertyId: string;
  roomTypeId: string | null;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  tags: string[];
  images: string[];
  travelerType: string | null;
  stayMonth: string | null;
  helpfulCount: number;
  createdAt: string;
}

export type ReviewSort = 'newest' | 'highest' | 'lowest' | 'helpful';

export interface ReviewFilter {
  propertyId: string;
  rating?: number;
  tag?: string;
  travelerType?: string;
  sort: ReviewSort;
  offset: number;
  limit: number;
}

export interface ReviewStats {
  count: number;
  average: number | null;
  /** Số đánh giá theo mức sao: phần tử 0 là 1 sao, phần tử 4 là 5 sao. */
  distribution: number[];
  /** Tag nhiều nhất trước. */
  tags: { tag: string; count: number }[];
}

export interface ReviewRepository {
  /** Một trang đánh giá công khai theo bộ lọc, kèm tổng số khớp bộ lọc. */
  listReviews(filter: ReviewFilter): Promise<{ items: ReviewRecord[]; total: number }>;
  /** Thống kê trên mọi đánh giá công khai của khách sạn (không theo bộ lọc). */
  getReviewStats(propertyId: string, tagLimit: number): Promise<ReviewStats>;
}

export interface CommerceStore {
  catalog: CatalogRepository;
  reviews: ReviewRepository;
  calendar: CalendarRepository;
  admin: CalendarAdminRepository;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export type Today = () => string;

export const COMMERCE_STORE = Symbol('COMMERCE_STORE');
export const TODAY = Symbol('COMMERCE_TODAY');

/** Lịch chỉ để hiển thị (trang tìm, chi tiết khách sạn): có thể cũ vài giây. Giữ chỗ, thanh toán luôn dùng COMMERCE_STORE. */
export type ReadCalendar = Pick<CalendarRepository, 'loadRoomDays' | 'loadFlightDays'>;
export const READ_CALENDAR = Symbol('COMMERCE_READ_CALENDAR');

/** Đổi khoá ảnh trên kho media thành URL cho web và app (ghép MEDIA_CDN_URL). Chưa cấu hình CDN thì trả nguyên khoá. */
export type MediaUrl = (key: string) => string;
export const MEDIA_URL = Symbol('COMMERCE_MEDIA_URL');
export const keepMediaKey: MediaUrl = (key) => key;
