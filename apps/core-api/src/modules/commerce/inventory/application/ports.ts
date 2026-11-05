import type { FlightDay, PricePlan, RoomDay } from '../domain/sales-rules.js';

export interface PropertyRecord {
  id: string;
  name: string;
  provinceSlug: string;
  provinceName: string;
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  thumbnail: string | null;
  images: string[];
}

export interface RoomTypeRecord {
  id: string;
  propertyId: string;
  name: string;
  maxGuests: number;
  defaultTotal: number;
  defaultPrice: number;
  ratePlans: PricePlan[];
}

export interface FlightRecord {
  id: string;
  flightKey: string;
  name: string;
  airline: string | null;
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
  findRoomTypesByPropertyIds(propertyIds: string[]): Promise<RoomTypeRecord[]>;
  findRoomTypesByIds(ids: string[]): Promise<RoomTypeRecord[]>;
  /** Các chuyến (theo flight_key tăng dần, sau afterKey) cùng mọi hạng ghế của chuyến đó. */
  listFlights(filter: { destinationSlug?: string; afterKey?: string; limit: number }): Promise<FlightRecord[]>;
  findFlightsByIds(ids: string[]): Promise<FlightRecord[]>;
  findFlightsByKeys(flightKeys: string[]): Promise<FlightRecord[]>;
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

export interface CommerceStore {
  catalog: CatalogRepository;
  calendar: CalendarRepository;
  admin: CalendarAdminRepository;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export type Today = () => string;

export const COMMERCE_STORE = Symbol('COMMERCE_STORE');
export const TODAY = Symbol('COMMERCE_TODAY');
