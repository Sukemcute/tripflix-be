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

export interface CommerceStore {
  catalog: CatalogRepository;
  calendar: CalendarRepository;
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export type Today = () => string;

export const COMMERCE_STORE = Symbol('COMMERCE_STORE');
export const TODAY = Symbol('COMMERCE_TODAY');
