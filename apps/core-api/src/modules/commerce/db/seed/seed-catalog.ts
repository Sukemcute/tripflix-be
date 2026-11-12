import { buildHotelSlug } from '../../inventory/domain/hotel-slug.js';
import { readFileSync } from 'node:fs';
import type { Db } from '@tripflix/db';
import { sql } from 'drizzle-orm';
import { flights, properties, roomTypes, type HotelDetails, type RatePlan, type RoomTypeDetails } from '../schema/index.js';
import { toHotelImageKey } from './image-keys.js';
import { seedReviews } from './seed-reviews.js';

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
    // Thông tin trang chi tiết (TF10); file seed cũ có thể chưa có.
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    ratingAvg?: number | null;
    reviewCount?: number;
    ratingSource?: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    details?: HotelDetails;
    roomTypes: {
      id: string;
      code: string;
      name: string;
      maxGuests: number;
      defaultTotal: number;
      priceFactor: number;
      ratePlans: RatePlan[];
      details?: RoomTypeDetails;
    }[];
  }[];
  flights: {
    id: string;
    flightKey: string;
    name: string;
    airline: string | null;
    // Bổ sung TF29: mã hãng, số hiệu chuyến, số điểm dừng.
    airlineCode?: string | null;
    flightNumber?: string | null;
    stops?: number;
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
  // Test tích hợp chỉ cần một phần danh mục: nạp đủ 2.200 khách sạn và 254.000 đánh giá thì quá giờ chuẩn bị.
  options: { shouldIncludeHotel?: (hotelId: string) => boolean } = {},
): Promise<{ hotels: number; roomTypes: number; flights: number; reviews: number }> {
  const seed = JSON.parse(readFileSync(file, 'utf8')) as CatalogSeed;
  if (options.shouldIncludeHotel) seed.hotels = seed.hotels.filter((h) => options.shouldIncludeHotel!(h.id));
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
      details: r.details ? { ...r.details, images: r.details.images?.map(toImageKey) } : {},
    })),
  );
  let reviewCount = 0;
  await db.transaction(async (tx) => {
    const hotelRows = seed.hotels.map(({ roomTypes: _roomTypes, basePrice: _basePrice, ...hotel }) => ({
    ...hotel,
    slug: buildHotelSlug(hotel.id, hotel.name),
    thumbnail: hotel.thumbnail ? toImageKey(hotel.thumbnail) : null,
    images: hotel.images.map(toImageKey),
    reviewCount: hotel.reviewCount ?? 0,
    details: hotel.details ?? {},
  }));
    for (const rows of chunk(hotelRows)) {
      await tx
        .insert(properties)
        .values(rows)
        .onConflictDoUpdate({
          target: properties.id,
          set: {
            slug: sql`excluded.slug`,
            name: sql`excluded.name`,
            provinceSlug: sql`excluded.province_slug`,
            provinceName: sql`excluded.province_name`,
            city: sql`excluded.city`,
            stars: sql`excluded.stars`,
            brand: sql`excluded.brand`,
            style: sql`excluded.style`,
            thumbnail: sql`excluded.thumbnail`,
            images: sql`excluded.images`,
            address: sql`excluded.address`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            ratingAvg: sql`excluded.rating_avg`,
            reviewCount: sql`excluded.review_count`,
            ratingSource: sql`excluded.rating_source`,
            checkInTime: sql`excluded.check_in_time`,
            checkOutTime: sql`excluded.check_out_time`,
            details: sql`excluded.details`,
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
          set: { name: sql`excluded.name`, maxGuests: sql`excluded.max_guests`, defaultTotal: sql`excluded.default_total`, defaultPrice: sql`excluded.default_price`, ratePlans: sql`excluded.rate_plans`, details: sql`excluded.details` },
        });
    }
    for (const rows of chunk(seed.flights.map(({ basePrice, ...f }) => ({ ...f, defaultPrice: roundToTenThousand(basePrice) })))) {
      await tx
        .insert(flights)
        .values(rows)
        .onConflictDoUpdate({
          target: flights.id,
          set: {
            name: sql`excluded.name`,
            airline: sql`excluded.airline`,
            airlineCode: sql`excluded.airline_code`,
            flightNumber: sql`excluded.flight_number`,
            stops: sql`excluded.stops`,
            departTime: sql`excluded.depart_time`,
            arriveTime: sql`excluded.arrive_time`,
            // Nơi đến theo cây địa điểm của discovery (sau sáp nhập tỉnh 2025); seed lại thì sửa cả dữ liệu cũ.
            destinationSlug: sql`excluded.destination_slug`,
            destinationName: sql`excluded.destination_name`,
            defaultSeats: sql`excluded.default_seats`,
            defaultPrice: sql`excluded.default_price`,
            farePlans: sql`excluded.fare_plans`,
          },
        });
    }
    // Sau khi có khách sạn, loại phòng: đánh giá demo trỏ khoá ngoại tới chúng; tóm tắt ghi đè lên details vừa nạp.
    reviewCount = await seedReviews(tx, seed.hotels, toImageKey);
  });
  return { hotels: seed.hotels.length, roomTypes: roomTypeRows.length, flights: seed.flights.length, reviews: reviewCount };
}
