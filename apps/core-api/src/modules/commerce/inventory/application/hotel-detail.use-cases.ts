import { Inject, Injectable } from '@nestjs/common';
import { CommerceError } from '../domain/errors.js';
import {
  MAX_ADULTS,
  MAX_NIGHTS,
  addDays,
  calculatePlanPrice,
  countNights,
  countRemaining,
  countRoomsNeeded,
  isIsoDate,
  quoteStay,
  type UnavailableReason,
} from '../domain/sales-rules.js';
import type { HotelAmenity } from '../../db/schema/index.js';
import { COMMERCE_STORE, MEDIA_URL, TODAY, keepMediaKey, type CommerceStore, type MediaUrl, type Today } from './ports.js';

const DEFAULT_ADULTS = 2;
const DEFAULT_CALENDAR_DAYS = 14;
const MAX_CALENDAR_DAYS = 60;

export interface HotelDetailQuery {
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  calendarDays?: number;
}

export interface HotelRatePlanQuote {
  code: string;
  name: string;
  meal: string;
  isRefundable: boolean;
  freeCancelDays: number;
  /** Cả kỳ ở, mọi phòng. null khi loại phòng không đặt được. */
  totalPrice: number | null;
  /** Một đêm một phòng. */
  pricePerNight: number | null;
  /** Giá gạch một đêm một phòng (giá niêm yết trước giảm); null khi gói không giảm hoặc không đặt được. */
  listPricePerNight: number | null;
  discountPct: number | null;
  perks: string[];
}

export interface HotelRoomOffer {
  productId: string;
  name: string;
  maxGuests: number;
  bedType: string | null;
  areaM2: number | null;
  view: string | null;
  images: string[];
  amenities: string[];
  roomsNeeded: number;
  isAvailable: boolean;
  reason: UnavailableReason | null;
  /** Số phòng thật còn lại suốt kỳ ở (không làm tròn, không tạo khan hiếm giả). */
  remaining: number | null;
  ratePlans: HotelRatePlanQuote[];
}

export interface HotelDetail {
  id: string;
  name: string;
  province: { slug: string; name: string };
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  thumbnail: string | null;
  images: string[];
  address: string | null;
  location: { lat: number; lng: number } | null;
  rating: { average: number; count: number; source: string | null } | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  description: string | null;
  highlights: { icon: string; text: string }[];
  nearby: { name: string; distanceKm: number }[];
  amenities: HotelAmenity[];
  languages: string[];
  facts: { voltage: string | null; floors: number | null; openedAt: string | null; roomCount: number | null; restaurants: number | null; bars: number | null };
  policies: { child: string | null; extraBed: string | null; deposit: string | null; depositAmount: number | null; stay: string | null };
  stay: { checkIn: string; checkOut: string; nights: number; adults: number };
  /** Giá một đêm rẻ nhất trong các loại phòng đặt được cho kỳ ở này. */
  priceFrom: number | null;
  isAvailable: boolean;
  rooms: HotelRoomOffer[];
  /** Giá một đêm rẻ nhất của từng ngày tới, để vẽ lịch giá. */
  calendar: { date: string; priceFrom: number | null; isAvailable: boolean }[];
}

/** Giá gạch: giá bán chia (1 − % giảm), làm tròn lên 10.000đ. Chỉ hiển thị, không phải giá khách trả. */
const toListPrice = (price: number, discountPct?: number) =>
  discountPct && discountPct > 0 && discountPct < 100 ? Math.ceil(price / (1 - discountPct / 100) / 10_000) * 10_000 : null;

/** Trang chi tiết khách sạn: ảnh, giá cho kỳ ở đang chọn, còn phòng thật, lịch giá vài tuần tới. Chỉ đọc. */
@Injectable()
export class HotelDetailUseCases {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(TODAY) private readonly today: Today,
    @Inject(MEDIA_URL) private readonly mediaUrl: MediaUrl = keepMediaKey,
  ) {}

  async getHotelDetail(hotelId: string, query: HotelDetailQuery = {}): Promise<HotelDetail> {
    const today = this.today();
    const checkIn = query.checkIn ?? today;
    const checkOut = query.checkOut ?? addDays(checkIn, 1);
    const adults = query.adults ?? DEFAULT_ADULTS;
    const calendarDays = query.calendarDays ?? DEFAULT_CALENDAR_DAYS;
    if (!isIsoDate(checkIn) || checkIn < today) throw new CommerceError('invalid_query', 'Ngày nhận phòng phải từ hôm nay trở đi.', 'checkIn');
    if (!isIsoDate(checkOut) || checkOut <= checkIn || countNights(checkIn, checkOut) > MAX_NIGHTS) {
      throw new CommerceError('invalid_query', `Ngày trả phòng phải sau ngày nhận phòng, ở tối đa ${MAX_NIGHTS} đêm.`, 'checkOut');
    }
    if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) throw new CommerceError('invalid_query', `Số khách từ 1 đến ${MAX_ADULTS}.`, 'adults');
    if (!Number.isInteger(calendarDays) || calendarDays < 1 || calendarDays > MAX_CALENDAR_DAYS) {
      throw new CommerceError('invalid_query', `calendarDays từ 1 đến ${MAX_CALENDAR_DAYS}.`, 'calendarDays');
    }

    const hotel = await this.store.catalog.findPropertyById(hotelId);
    if (!hotel) throw new CommerceError('not_found', 'Không có khách sạn này.');
    const roomTypes = await this.store.catalog.findRoomTypesByPropertyIds([hotel.id]);
    const calendarEnd = addDays(today, calendarDays - 1);
    // Một lần đọc cho cả kỳ ở (gồm ngày trả phòng để xét CTD) và lịch giá.
    const from = checkIn < today ? checkIn : today;
    const to = checkOut > calendarEnd ? checkOut : calendarEnd;
    const days = await this.store.calendar.loadRoomDays(roomTypes.map((r) => r.id), from, to);

    const rooms = roomTypes.map((r): HotelRoomOffer => {
      const roomsNeeded = countRoomsNeeded(adults, r.maxGuests);
      const quotes = r.ratePlans.map((plan) => ({ plan, quote: quoteStay({ days: days.get(r.id) ?? [], checkIn, checkOut, rooms: roomsNeeded, plan }) }));
      const first = quotes[0]?.quote;
      return {
        productId: r.id,
        name: r.name,
        maxGuests: r.maxGuests,
        bedType: r.details?.bedType ?? null,
        areaM2: r.details?.areaM2 ?? null,
        view: r.details?.view ?? null,
        images: (r.details?.images ?? []).map(this.mediaUrl),
        amenities: r.details?.amenities ?? [],
        roomsNeeded,
        isAvailable: first?.isAvailable ?? false,
        reason: first && !first.isAvailable ? first.reason : null,
        remaining: first?.isAvailable ? first.remaining : (first?.remaining ?? null),
        ratePlans: quotes.map(({ plan, quote }) => ({
          code: plan.code,
          name: plan.name,
          meal: plan.meal,
          isRefundable: plan.refundable,
          freeCancelDays: plan.freeCancelDays,
          totalPrice: quote.isAvailable ? quote.totalPrice : null,
          pricePerNight: quote.isAvailable ? quote.pricePerNight : null,
          listPricePerNight: quote.isAvailable ? toListPrice(quote.pricePerNight, plan.discountPct) : null,
          discountPct: plan.discountPct ? plan.discountPct : null,
          perks: plan.perks ?? [],
        })),
      };
    });

    const bookablePrices = rooms.flatMap((r) => (r.isAvailable ? [r.ratePlans[0]!.pricePerNight!] : []));
    const calendar = Array.from({ length: calendarDays }, (_, i) => addDays(today, i)).map((date) => {
      const prices = roomTypes.flatMap((r) => {
        const day = days.get(r.id)?.find((d) => d.date === date);
        return day && countRemaining(day) > 0 ? [calculatePlanPrice(day.price, r.ratePlans[0]!)] : [];
      });
      return { date, priceFrom: prices.length ? Math.min(...prices) : null, isAvailable: prices.length > 0 };
    });

    const d = hotel.details ?? {};
    return {
      id: hotel.id,
      name: hotel.name,
      province: { slug: hotel.provinceSlug, name: hotel.provinceName },
      city: hotel.city,
      stars: hotel.stars,
      brand: hotel.brand,
      style: hotel.style,
      thumbnail: hotel.thumbnail ? this.mediaUrl(hotel.thumbnail) : null,
      images: hotel.images.map(this.mediaUrl),
      address: hotel.address ?? null,
      location: hotel.lat != null && hotel.lng != null ? { lat: hotel.lat, lng: hotel.lng } : null,
      rating: hotel.ratingAvg != null ? { average: hotel.ratingAvg, count: hotel.reviewCount ?? 0, source: hotel.ratingSource ?? null } : null,
      checkInTime: hotel.checkInTime ?? null,
      checkOutTime: hotel.checkOutTime ?? null,
      description: d.description ?? null,
      highlights: d.highlights ?? [],
      nearby: d.nearby ?? [],
      amenities: d.amenities ?? [],
      languages: d.languages ?? [],
      facts: {
        voltage: d.facts?.voltage ?? null,
        floors: d.facts?.floors ?? null,
        openedAt: d.facts?.openedAt ?? null,
        roomCount: d.facts?.roomCount ?? null,
        restaurants: d.facts?.restaurants ?? null,
        bars: d.facts?.bars ?? null,
      },
      policies: {
        child: d.policies?.child ?? null,
        extraBed: d.policies?.extraBed ?? null,
        deposit: d.policies?.deposit ?? null,
        depositAmount: d.policies?.depositAmount ?? null,
        stay: d.policies?.stay ?? null,
      },
      stay: { checkIn, checkOut, nights: countNights(checkIn, checkOut), adults },
      priceFrom: bookablePrices.length ? Math.min(...bookablePrices) : null,
      isAvailable: bookablePrices.length > 0,
      rooms,
      calendar,
    };
  }
}
