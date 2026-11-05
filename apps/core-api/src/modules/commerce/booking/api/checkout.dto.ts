import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const CheckoutRequestSchema = z
  .object({
    adults: z.number().int().min(1).max(9),
    sourcePostId: z.string().max(100).nullish(),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1).max(100),
            checkIn: IsoDateSchema,
            checkOut: IsoDateSchema.optional(),
            qty: z.number().int().min(1).max(9).optional(),
            ratePlanCode: z.string().max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

const ORDER_STATUS_VALUES = ['pending', 'paying', 'paid', 'cancelled', 'expired'] as const;

export const ListTripsQuerySchema = z
  .object({
    // ?status=paid,expired; bỏ trống là mọi trạng thái.
    status: z
      .string()
      .max(100)
      .transform((value) => [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))])
      .pipe(z.array(z.enum(ORDER_STATUS_VALUES)))
      .optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();

export const SetGuestsRequestSchema = z
  .object({
    contact: z.object({ fullName: z.string().max(100), phone: z.string().max(20), email: z.string().max(254).nullish() }).strict(),
    guests: z.array(z.object({ fullName: z.string().max(100), birthdate: IsoDateSchema.nullish() }).strict()).max(9).default([]),
  })
  .strict();

export const PayRequestSchema = z
  .object({
    paymentToken: z.string().min(1).max(100),
    expectedTotal: z.number().int().positive(),
    acceptedPolicyVersion: z.string().min(1).max(20),
  })
  .strict();

export const ConfirmThreeDsRequestSchema = z.object({ challengeId: z.string().min(1).max(100), otp: z.string().min(1).max(10) }).strict();

export const CreateTokenRequestSchema = z.object({ cardNumber: z.string().min(12).max(23) }).strict();

class CheckoutItemRequestDto {
  @ApiProperty({ example: 'P-h-dn-01--DLX', description: 'Mã loại phòng hoặc mã hạng ghế' }) productId!: string;
  @ApiProperty({ format: 'date', description: 'Ngày nhận phòng / ngày bay' }) checkIn!: string;
  @ApiPropertyOptional({ format: 'date', description: 'Ngày trả phòng (bắt buộc với phòng)' }) checkOut?: string;
  @ApiPropertyOptional({ description: 'Số phòng; bỏ trống thì tự tính theo số khách. Vé bay luôn bằng số khách' }) qty?: number;
  @ApiPropertyOptional({ example: 'RO', description: 'Mặc định gói đầu tiên' }) ratePlanCode?: string;
}

export class CheckoutRequestDto {
  @ApiProperty({ minimum: 1, maximum: 9 }) adults!: number;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Bài đăng dẫn tới đơn này (Đặt y chang)' }) sourcePostId?: string | null;
  @ApiProperty({ type: [CheckoutItemRequestDto] }) items!: CheckoutItemRequestDto[];
}

class ContactDto {
  @ApiProperty() fullName!: string;
  @ApiProperty({ example: '0901234567' }) phone!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) email?: string | null;
}

class GuestDto {
  @ApiProperty({ description: 'Họ tên theo giấy tờ' }) fullName!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, description: 'Bắt buộc khi có vé bay' }) birthdate?: string | null;
}

export class SetGuestsRequestDto {
  @ApiProperty({ type: ContactDto }) contact!: ContactDto;
  @ApiProperty({ type: [GuestDto], description: 'Có vé bay thì cần đủ số khách' }) guests!: GuestDto[];
}

export class PayRequestDto {
  @ApiProperty({ description: 'Token thẻ do cổng cấp (mock: POST /api/mock-gateway/tokens)' }) paymentToken!: string;
  @ApiProperty({ description: 'Tổng tiền khách đang thấy; khác giá hiện tại thì 409 PRICE_CHANGED, chưa trừ tiền' }) expectedTotal!: number;
  @ApiProperty({ example: '2026-11-03' }) acceptedPolicyVersion!: string;
}

export class ConfirmThreeDsRequestDto {
  @ApiProperty() challengeId!: string;
  @ApiProperty({ example: '123456' }) otp!: string;
}

export class CreateTokenRequestDto {
  @ApiProperty({ example: '4242424242424242', description: 'Chỉ thẻ test' }) cardNumber!: string;
}

class CheckoutItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['room', 'flight'] }) productType!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ format: 'date' }) dateTo!: string;
  @ApiProperty() nights!: number;
  @ApiProperty() qty!: number;
  @ApiProperty({ description: 'Một đêm một phòng / một vé (VND)' }) unitPrice!: number;
  @ApiProperty() lineTotal!: number;
  @ApiProperty() ratePlanCode!: string;
  @ApiProperty() ratePlanName!: string;
  @ApiProperty() isRefundable!: boolean;
  @ApiProperty({ type: String, format: 'date', nullable: true }) freeCancelUntil!: string | null;
  @ApiProperty({ type: String, nullable: true }) confirmationCode!: string | null;
}

export class CheckoutDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: ['pending', 'paying', 'paid', 'cancelled', 'expired'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) holdExpiresAt!: string;
  @ApiProperty() total!: number;
  @ApiProperty() adults!: number;
  @ApiProperty({ type: String, nullable: true }) confirmationCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason!: string | null;
  @ApiProperty({ type: [CheckoutItemDto] }) items!: CheckoutItemDto[];
  @ApiProperty() isGuestInfoComplete!: boolean;
  @ApiProperty({ description: 'Số hành khách cần nhập (0 khi không có vé bay)' }) passengersRequired!: number;
  @ApiProperty() policyVersion!: string;
}

export class SetGuestsResultDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: [true] }) isGuestInfoComplete!: true;
}

export class CancelHoldResultDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: ['cancelled'] }) status!: 'cancelled';
}

export class PayResultDto {
  @ApiProperty({ enum: ['paid', 'requires_action', 'pending'] }) outcome!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) confirmationCode?: string | null;
  @ApiPropertyOptional({ description: 'Khi outcome = requires_action: gửi kèm OTP tới /3ds' }) challengeId?: string;
  @ApiPropertyOptional({ description: 'Khi outcome = pending: chưa rõ kết quả, gọi lại GET /checkout/:id sau ít giây' }) message?: string;
  @ApiPropertyOptional({ type: CheckoutDto }) checkout?: CheckoutDto;
}

export class TokenDto {
  @ApiProperty() paymentToken!: string;
  @ApiProperty() last4!: string;
  @ApiProperty() isTestCard!: boolean;
}

export class ListTripsQueryDto {
  @ApiPropertyOptional({ example: 'paid,expired', description: 'Lọc trạng thái, nhiều giá trị cách nhau bởi dấu phẩy (pending, paying, paid, cancelled, expired). Bỏ trống: mọi trạng thái' })
  status?: string;
  @ApiPropertyOptional({ description: 'Lấy từ nextCursor của trang trước' }) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 }) limit?: number;
}

export class TripDto {
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ enum: ['pending', 'paying', 'paid', 'cancelled', 'expired'] }) status!: string;
  @ApiProperty() total!: number;
  @ApiProperty() adults!: number;
  @ApiProperty({ type: String, nullable: true }) confirmationCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason!: string | null;
  @ApiProperty({ format: 'date-time' }) holdExpiresAt!: string;
  @ApiProperty({ format: 'date-time', description: 'Lúc đặt' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) paidAt!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Ngày đi sớm nhất trong đơn' }) startDate!: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'Ngày về / trả phòng muộn nhất trong đơn' }) endDate!: string | null;
  @ApiProperty({ type: [CheckoutItemDto] }) items!: CheckoutItemDto[];
}

export class TripPageDto {
  @ApiProperty({ type: [TripDto], description: 'Mới đặt trước' }) trips!: TripDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Gửi lại làm cursor để lấy trang sau; null là hết' }) nextCursor!: string | null;
}
