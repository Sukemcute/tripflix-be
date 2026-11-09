import { Inject, Injectable } from '@nestjs/common';
import { CommerceError } from '../domain/errors.js';
import { COMMERCE_STORE, MEDIA_URL, keepMediaKey, type CommerceStore, type MediaUrl, type ReviewSort } from './ports.js';

export const REVIEW_SORTS: ReviewSort[] = ['newest', 'highest', 'lowest', 'helpful'];
export const TRAVELER_TYPES = ['family', 'couple', 'solo', 'business', 'friends'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const TAG_LIMIT = 10;

export interface HotelReviewQuery {
  sort?: ReviewSort;
  rating?: number;
  tag?: string;
  travelerType?: string;
  page?: number;
  limit?: number;
}

export interface HotelReview {
  id: string;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  tags: string[];
  images: string[];
  travelerType: string | null;
  stayMonth: string | null;
  room: { productId: string; name: string } | null;
  helpfulCount: number;
  createdAt: string;
}

export interface HotelReviewPage {
  hotelId: string;
  summary: {
    /** Điểm trung bình đánh giá trên Tripflix, 1 chữ số thập phân; null khi chưa có đánh giá. */
    average: number | null;
    count: number;
    /** Số đánh giá theo từng mức sao, từ 5 sao xuống 1 sao. */
    distribution: { rating: number; count: number }[];
    tags: { tag: string; count: number }[];
    /** Đoạn tóm tắt ý kiến khách; null khi chưa có. */
    aiSummary: string | null;
  };
  items: HotelReview[];
  page: number;
  limit: number;
  total: number;
}

/** Đánh giá của khách trên trang chi tiết khách sạn. Công khai, chỉ đọc; chỉ trả đánh giá đã công khai. */
@Injectable()
export class ReviewUseCases {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(MEDIA_URL) private readonly mediaUrl: MediaUrl = keepMediaKey,
  ) {}

  async listHotelReviews(hotelId: string, query: HotelReviewQuery = {}): Promise<HotelReviewPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sort = query.sort ?? 'newest';
    if (!Number.isInteger(page) || page < 1) throw new CommerceError('invalid_query', 'page từ 1 trở lên.', 'page');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new CommerceError('invalid_query', `limit từ 1 đến ${MAX_LIMIT}.`, 'limit');
    if (!REVIEW_SORTS.includes(sort)) throw new CommerceError('invalid_query', `sort là một trong ${REVIEW_SORTS.join(', ')}.`, 'sort');
    if (query.rating !== undefined && (!Number.isInteger(query.rating) || query.rating < 1 || query.rating > 5)) {
      throw new CommerceError('invalid_query', 'rating từ 1 đến 5.', 'rating');
    }

    const hotel = await this.store.catalog.findPropertyBySlugOrId(hotelId);
    if (!hotel) throw new CommerceError('not_found', 'Không có khách sạn này.');
    const [stats, found, roomTypes] = await Promise.all([
      this.store.reviews.getReviewStats(hotel.id, TAG_LIMIT),
      this.store.reviews.listReviews({ propertyId: hotel.id, rating: query.rating, tag: query.tag, travelerType: query.travelerType, sort, offset: (page - 1) * limit, limit }),
      this.store.catalog.findRoomTypesByPropertyIds([hotel.id]),
    ]);
    const roomNames = new Map(roomTypes.map((r) => [r.id, r.name]));

    return {
      hotelId: hotel.id,
      summary: {
        average: stats.average === null ? null : Math.round(stats.average * 10) / 10,
        count: stats.count,
        distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: stats.distribution[rating - 1] ?? 0 })),
        tags: stats.tags,
        aiSummary: hotel.details?.reviewSummary ?? null,
      },
      items: found.items.map((r) => ({
        id: r.id,
        authorName: r.authorName,
        rating: r.rating,
        title: r.title,
        body: r.body,
        tags: r.tags,
        images: r.images.map(this.mediaUrl),
        travelerType: r.travelerType,
        stayMonth: r.stayMonth,
        room: r.roomTypeId && roomNames.has(r.roomTypeId) ? { productId: r.roomTypeId, name: roomNames.get(r.roomTypeId)! } : null,
        helpfulCount: r.helpfulCount,
        createdAt: r.createdAt,
      })),
      page,
      limit,
      total: found.total,
    };
  }
}
