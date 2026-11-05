import { readFileSync } from 'node:fs';
import type { Db } from '@tripflix/db';
import { sql } from 'drizzle-orm';
import { flights, properties, roomTypes, type RatePlan } from '../schema/index.js';
import { toHotelImageKey } from './image-keys.js';

/** Dữ liệu giả lập: khách sạn, loại phòng, chuyến bay theo hạng ghế. Lịch trống không nằm ở đây mà do job sinh. */
interface CatalogSeed {
  hotels: {
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
    basePrice: number;
    roomTypes: { id: string; code: string; name: string; maxGuests: number; defaultTotal: number; priceFactor: number; ratePlans: RatePlan[] }[];
  }[];
  flights: {
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
    cabinCode: string;
    cabinName: string;
    defaultSeats: number;
    basePrice: number;
    farePlans: RatePlan[];
  }[];
}

// Đường dẫn tính từ apps/core-api, giống cách migrate tìm thư mục migrations.
export const CATALOG_SEED_FILE = 'src/modules/commerce/db/seed/catalog.json';
const BATCH = 500;

const roundToTenThousand = (amount: number) => Math.max(10_000, Math.round(amount / 10_000) * 10_000);

function chunk<T>(rows: T[]): T[][] {
  return Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) => rows.slice(i * BATCH, (i + 1) * BATCH));
}

/**
 * Nạp danh mục, chạy lại được: sản phẩm đã có thì cập nhật tên, ảnh, giá mặc định; không động vào lịch trống,
 * số đã giữ, đã bán. Một transaction: lỗi giữa chừng thì không có danh mục nửa vời.
 */
export async function seedCatalog(
  db: Db,
  file = CATALOG_SEED_FILE,
  // Ảnh lưu khoá đầy đủ trên kho media (thêm tiền tố môi trường, như S3ObjectStorage.resolveKey); mặc định giữ khoá tương đối.
  resolveImageKey: (relativeKey: string) => string = (relativeKey) => relativeKey,
): Promise<{ hotels: number; roomTypes: number; flights: number }> {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as CatalogSeed;
  const toImageKey = (sourcePath: string) => {
    const key = toHotelImageKey(sourcePath);
    return /^https?:\/\//.test(key) ? key : resolveImageKey(key);
  };
  const roomTypeRows = seed.hotels.flatMap((h) =>
    h.roomTypes.map((r) => ({
      id: r.id,
      propertyId: h.id,
      code: r.code,
      name: r.name,
      maxGuests: r.maxGuests,
      defaultTotal: r.defaultTotal,
      defaultPrice: roundToTenThousand(h.basePrice * r.priceFactor),
      ratePlans: r.ratePlans,
    })),
  );
  await db.transaction(async (tx) => {
    const hotelRows = seed.hotels.map(({ roomTypes: _roomTypes, basePrice: _basePrice, ...hotel }) => ({
    ...hotel,
    thumbnail: hotel.thumbnail ? toImageKey(hotel.thumbnail) : null,
    images: hotel.images.map(toImageKey),
  }));
    for (const rows of chunk(hotelRows)) {
      await tx
        .insert(properties)
        .values(rows)
        .onConflictDoUpdate({
          target: properties.id,
          set: {
            name: sql`excluded.name`,
            provinceSlug: sql`excluded.province_slug`,
            provinceName: sql`excluded.province_name`,
            city: sql`excluded.city`,
            stars: sql`excluded.stars`,
            brand: sql`excluded.brand`,
            style: sql`excluded.style`,
            thumbnail: sql`excluded.thumbnail`,
            images: sql`excluded.images`,
            updatedAt: sql`now()`,
          },
        });
    }
    for (const rows of chunk(roomTypeRows)) {
      await tx
        .insert(roomTypes)
        .values(rows)
        .onConflictDoUpdate({
          target: roomTypes.id,
          set: { name: sql`excluded.name`, maxGuests: sql`excluded.max_guests`, defaultTotal: sql`excluded.default_total`, defaultPrice: sql`excluded.default_price`, ratePlans: sql`excluded.rate_plans` },
        });
    }
    for (const rows of chunk(seed.flights.map(({ basePrice, ...f }) => ({ ...f, defaultPrice: roundToTenThousand(basePrice) })))) {
      await tx
        .insert(flights)
        .values(rows)
        .onConflictDoUpdate({
          target: flights.id,
          set: { name: sql`excluded.name`, airline: sql`excluded.airline`, departTime: sql`excluded.depart_time`, arriveTime: sql`excluded.arrive_time`, defaultSeats: sql`excluded.default_seats`, defaultPrice: sql`excluded.default_price`, farePlans: sql`excluded.fare_plans` },
        });
    }
  });
  return { hotels: seed.hotels.length, roomTypes: roomTypeRows.length, flights: seed.flights.length };
}
