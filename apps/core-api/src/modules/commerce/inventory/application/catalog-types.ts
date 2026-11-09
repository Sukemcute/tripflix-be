// Kiểu dữ liệu commerce trả cho module khác qua CommerceFacade. Chỉ thêm trường, không đổi hay bỏ trường đã có.
import type { UnavailableReason } from '../domain/sales-rules.js';

export type CatalogProductType = 'hotel' | 'flight';

export interface ListCatalogQuery {
  /** Mặc định hotel. */
  type?: CatalogProductType;
  /** Tỉnh thành (khách sạn) hoặc nơi đến (chuyến bay). */
  provinceSlug?: string;
  /** Lấy từ nextCursor của trang trước. */
  cursor?: string | null;
  /** 1–200, mặc định 50. */
  limit?: number;
  /** Số ngày tính từ hôm nay để tính giá thấp nhất và số ngày còn bán, 1–93, mặc định 30. */
  days?: number;
}

export interface CatalogRatePlan {
  code: string;
  name: string;
  meal: string;
  isRefundable: boolean;
}

/** Một lựa chọn đặt được: loại phòng của khách sạn hoặc hạng ghế của chuyến bay. productId dùng khi đặt chỗ. */
export interface CatalogOption {
  productId: string;
  name: string;
  maxGuests: number;
  basePrice: number;
  /** Giá thấp nhất trong khoảng days, gói giá mặc định. Khách sạn: một đêm một phòng. Chuyến bay: một vé. */
  priceFrom: number | null;
  availableDays: number;
  ratePlans: CatalogRatePlan[];
}

export interface CatalogHotel {
  type: 'hotel';
  id: string;
  /** Luôn có khi đọc từ commerce; optional để các test dựng sẵn CatalogHotel của module khác không phải đổi. */
  slug?: string;
  name: string;
  province: { slug: string; name: string };
  city: string | null;
  stars: number | null;
  brand: string | null;
  style: string | null;
  thumbnail: string | null;
  images: string[];
  priceFrom: number | null;
  isAvailable: boolean;
  options: CatalogOption[];
  /** Thêm 06/11 (TF11, discovery cần cho tìm theo tên đường và gần tôi). Null khi chưa có dữ liệu. */
  address: string | null;
  location: { lat: number; lng: number } | null;
}

export interface CatalogFlight {
  type: 'flight';
  /** Mã chuyến, gom các hạng ghế. */
  id: string;
  name: string;
  airline: string | null;
  fromAirport: string;
  toAirport: string;
  departTime: string | null;
  arriveTime: string | null;
  province: { slug: string; name: string };
  priceFrom: number | null;
  isAvailable: boolean;
  options: CatalogOption[];
}

export type CatalogItem = CatalogHotel | CatalogFlight;

export interface CatalogPage {
  from: string;
  to: string;
  items: CatalogItem[];
  nextCursor: string | null;
}

export interface CheckAvailabilityQuery {
  /** Mã khách sạn, mã loại phòng, mã chuyến hoặc mã hạng ghế; tối đa 100. */
  productIds: string[];
  checkIn: string;
  /** Bắt buộc với khách sạn; chuyến bay bỏ qua. */
  checkOut?: string;
  /** Số phòng; bỏ trống thì tự tính theo số khách và sức chứa từng loại phòng. */
  rooms?: number;
  adults: number;
}

export interface AvailabilityResult {
  /** Đúng mã đã gửi lên. */
  productId: string;
  isFound: boolean;
  isAvailable: boolean;
  /** Lựa chọn rẻ nhất còn đặt được (loại phòng / hạng ghế); null khi không có. */
  optionId: string | null;
  reason: UnavailableReason | null;
  roomsNeeded: number | null;
  remaining: number | null;
  /** Tổng tiền cả kỳ ở / mọi vé, gói giá mặc định. */
  totalPrice: number | null;
  /** Một đêm một phòng / một vé. */
  unitPrice: number | null;
  ratePlanCode: string | null;
}
