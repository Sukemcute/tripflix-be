import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core';
import { commerceSchema } from './commerce-schema.js';

/** Một gói giá của loại phòng hoặc hạng ghế: ăn sáng, hoàn huỷ, hệ số giá so với giá gốc của ngày. */
export interface RatePlan {
  code: string;
  name: string;
  // none | breakfast; để string vì dữ liệu nguồn có thể thêm loại mới.
  meal: string;
  refundable: boolean;
  freeCancelDays: number;
  priceFactor: number;
  /** % giảm so với giá niêm yết, chỉ để hiện giá gạch; không đổi số tiền khách trả. */
  discountPct?: number;
  /** Quyền lợi kèm gói, ví dụ "Bữa sáng buffet cho 2 người". */
  perks?: string[];
}

/** Một tiện ích của khách sạn. group: dining | sports | wellness | kids | general. featured: hiện ở mục "Tiện ích nổi bật". */
export interface HotelAmenity {
  group: string;
  name: string;
  icon: string;
  featured: boolean;
}

/** Thông tin hiển thị ở trang chi tiết, không dùng để lọc hay tính giá nên gom vào một cột JSONB. */
export interface HotelDetails {
  description?: string;
  /** Tóm tắt ý kiến khách (sau này do AI sinh từ đánh giá; dữ liệu demo do seed nạp). */
  reviewSummary?: string;
  highlights?: { icon: string; text: string }[];
  nearby?: { name: string; distanceKm: number }[];
  amenities?: HotelAmenity[];
  languages?: string[];
  facts?: {
    voltage?: string | null;
    floors?: number;
    openedAt?: string;
    roomCount?: number;
    restaurants?: number;
    bars?: number;
  };
  policies?: {
    child?: string;
    extraBed?: string;
    deposit?: string;
    depositAmount?: number;
    stay?: string;
  };
}

/** Thông tin hiển thị của loại phòng. view: city | sea | garden | mountain | pool | river. */
export interface RoomTypeDetails {
  bedType?: string;
  areaM2?: number;
  view?: string;
  images?: string[];
  amenities?: string[];
}

/** Khách sạn. Dữ liệu giả lập do seed nạp; ảnh là đường dẫn, file ảnh nằm ở kho media. */
export const properties = commerceSchema.table(
  'properties',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provinceSlug: text('province_slug').notNull(),
    provinceName: text('province_name').notNull(),
    city: text('city'),
    stars: smallint('stars'),
    brand: text('brand'),
    style: text('style'),
    thumbnail: text('thumbnail'),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    address: text('address'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    ratingAvg: doublePrecision('rating_avg'),
    reviewCount: integer('review_count').notNull().default(0),
    // tripadvisor | google: nguồn của điểm đánh giá.
    ratingSource: text('rating_source'),
    // Giờ địa phương dạng HH:MM.
    checkInTime: text('check_in_time'),
    checkOutTime: text('check_out_time'),
    details: jsonb('details').$type<HotelDetails>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_properties_province_slug').on(t.provinceSlug),
    check('ck_properties_stars', sql`${t.stars} is null or ${t.stars} between 1 and 5`),
    check('ck_properties_rating_avg', sql`${t.ratingAvg} is null or ${t.ratingAvg} between 0 and 5`),
    check('ck_properties_review_count', sql`${t.reviewCount} >= 0`),
  ],
);

/** Loại phòng: đơn vị đặt chỗ của khách sạn. default_* là giá trị job dùng khi mở ngày mới. */
export const roomTypes = commerceSchema.table(
  'room_types',
  {
    id: text('id').primaryKey(),
    propertyId: text('property_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    maxGuests: smallint('max_guests').notNull(),
    defaultTotal: integer('default_total').notNull(),
    defaultPrice: bigint('default_price', { mode: 'number' }).notNull(),
    ratePlans: jsonb('rate_plans').$type<RatePlan[]>().notNull(),
    details: jsonb('details').$type<RoomTypeDetails>().notNull().default({}),
  },
  (t) => [
    foreignKey({ name: 'fk_room_types_property_id', columns: [t.propertyId], foreignColumns: [properties.id] }),
    index('idx_room_types_property_id').on(t.propertyId),
    check('ck_room_types_max_guests', sql`${t.maxGuests} > 0`),
    check('ck_room_types_default_total', sql`${t.defaultTotal} >= 0`),
    check('ck_room_types_default_price', sql`${t.defaultPrice} > 0`),
  ],
);

/**
 * Số phòng theo ngày. CHECK là chốt chặn cuối: không thể giữ hay bán quá tổng, kể cả khi code sai.
 * stop_sell, cta (không nhận phòng), ctd (không trả phòng), min_los/max_los là luật bán của ngày nhận phòng.
 */
export const roomInventory = commerceSchema.table(
  'room_inventory',
  {
    roomTypeId: text('room_type_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    total: integer('total').notNull(),
    held: integer('held').notNull().default(0),
    sold: integer('sold').notNull().default(0),
    stopSell: boolean('stop_sell').notNull().default(false),
    cta: boolean('cta').notNull().default(false),
    ctd: boolean('ctd').notNull().default(false),
    minLos: smallint('min_los').notNull().default(1),
    maxLos: smallint('max_los').notNull().default(14),
  },
  (t) => [
    primaryKey({ name: 'pk_room_inventory', columns: [t.roomTypeId, t.date] }),
    foreignKey({ name: 'fk_room_inventory_room_type_id', columns: [t.roomTypeId], foreignColumns: [roomTypes.id] }),
    check('ck_room_inventory_not_oversold', sql`${t.held} >= 0 and ${t.sold} >= 0 and ${t.held} + ${t.sold} <= ${t.total}`),
    check('ck_room_inventory_los', sql`${t.minLos} >= 1 and ${t.maxLos} >= ${t.minLos}`),
  ],
);

/** Giá gốc một đêm theo ngày, trước hệ số của gói giá. */
export const roomRates = commerceSchema.table(
  'room_rates',
  {
    roomTypeId: text('room_type_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    price: bigint('price', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_room_rates', columns: [t.roomTypeId, t.date] }),
    foreignKey({ name: 'fk_room_rates_room_type_id', columns: [t.roomTypeId], foreignColumns: [roomTypes.id] }),
    check('ck_room_rates_price', sql`${t.price} > 0`),
  ],
);

/** Chuyến bay theo hạng ghế: mỗi dòng là một đơn vị đặt chỗ. flight_key gom các hạng của cùng một chuyến. */
export const flights = commerceSchema.table(
  'flights',
  {
    id: text('id').primaryKey(),
    flightKey: text('flight_key').notNull(),
    name: text('name').notNull(),
    airline: text('airline'),
    fromAirport: text('from_airport').notNull(),
    toAirport: text('to_airport').notNull(),
    departTime: text('depart_time'),
    arriveTime: text('arrive_time'),
    destinationSlug: text('destination_slug').notNull(),
    destinationName: text('destination_name').notNull(),
    cabinCode: text('cabin_code').notNull(),
    cabinName: text('cabin_name').notNull(),
    defaultSeats: integer('default_seats').notNull(),
    defaultPrice: bigint('default_price', { mode: 'number' }).notNull(),
    farePlans: jsonb('fare_plans').$type<RatePlan[]>().notNull(),
  },
  (t) => [
    index('idx_flights_route').on(t.fromAirport, t.toAirport),
    index('idx_flights_flight_key').on(t.flightKey),
    check('ck_flights_default_seats', sql`${t.defaultSeats} >= 0`),
    check('ck_flights_default_price', sql`${t.defaultPrice} > 0`),
  ],
);

/** Số ghế và giá một vé theo ngày bay. */
export const flightInventory = commerceSchema.table(
  'flight_inventory',
  {
    flightId: text('flight_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    total: integer('total').notNull(),
    held: integer('held').notNull().default(0),
    sold: integer('sold').notNull().default(0),
    price: bigint('price', { mode: 'number' }).notNull(),
    stopSell: boolean('stop_sell').notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'pk_flight_inventory', columns: [t.flightId, t.date] }),
    foreignKey({ name: 'fk_flight_inventory_flight_id', columns: [t.flightId], foreignColumns: [flights.id] }),
    check('ck_flight_inventory_not_oversold', sql`${t.held} >= 0 and ${t.sold} >= 0 and ${t.held} + ${t.sold} <= ${t.total}`),
    check('ck_flight_inventory_price', sql`${t.price} > 0`),
  ],
);

export type PropertyRow = typeof properties.$inferSelect;
export type RoomTypeRow = typeof roomTypes.$inferSelect;
export type FlightRow = typeof flights.$inferSelect;
