import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  PostRecord,
  PostStatus,
  PostType,
  PostVisibility,
  TripAttachmentData,
  TripItineraryItem,
} from '../../../db/schema/index.js';

export class TripItineraryItemDto implements TripItineraryItem {
  @ApiProperty({ example: 1, description: 'Số ngày trong lộ trình' })
  day!: number;

  @ApiProperty({ example: 'Check-in khách sạn & ngắm hoàng hôn', description: 'Tiêu đề hoạt động' })
  title!: string;

  @ApiPropertyOptional({ example: 'Bãi Dài, Phú Quốc', description: 'Địa điểm' })
  location?: string;

  @ApiPropertyOptional({ example: 'Nên đi tầm 16:30 để đón hoàng hôn đẹp nhất', description: 'Ghi chú' })
  notes?: string;
}

export class TripAttachmentDto implements TripAttachmentData {
  @ApiPropertyOptional({ example: '018d9f10-book-7000-8000-000000000099', description: 'ID đơn đặt chỗ đã đi' })
  bookingId?: string;

  @ApiPropertyOptional({ example: 'Vinpearl Resort & Spa Phú Quốc', description: 'Tên khách sạn' })
  hotelName?: string;

  @ApiPropertyOptional({ example: '018d9f10-prop-7000-8000-000000000010', description: 'ID khách sạn' })
  hotelId?: string;

  @ApiPropertyOptional({ example: 'Phú Quốc, Kiên Giang', description: 'Điểm đến' })
  destinationName?: string;

  @ApiPropertyOptional({ example: 3, description: 'Số ngày' })
  daysCount?: number;

  @ApiPropertyOptional({ example: 3500000, description: 'Chi phí ước tính / người' })
  estimatedCostPerPerson?: number;

  @ApiPropertyOptional({ example: 'Giá chỉ mang tính chất tham khảo', description: 'Lưu ý giá tham khảo' })
  priceDisclaimer?: string;

  @ApiPropertyOptional({ type: [TripItineraryItemDto], description: 'Các mục trong lịch trình' })
  items?: TripItineraryItemDto[];
}

export class CreatePostDto {
  @ApiProperty({ enum: ['video', 'vlog'], example: 'video', description: 'Loại bài đăng' })
  post_type!: PostType;

  @ApiProperty({ example: 'Khám phá Phú Quốc 3N2Đ cực chất', description: 'Tiêu đề bài viết' })
  title!: string;

  @ApiPropertyOptional({ example: 'Chia sẻ toàn bộ kinh nghiệm ăn chơi...', description: 'Nội dung chi tiết' })
  body?: string;

  @ApiPropertyOptional({ example: ['phuquoc', 'travel', 'vinpearl'], type: [String], description: 'Hashtags' })
  hashtags?: string[];

  @ApiPropertyOptional({ enum: ['public', 'private'], default: 'public', description: 'Quyền riêng tư' })
  visibility?: PostVisibility;

  @ApiPropertyOptional({ example: ['018d9f10-1234-7000-8000-000000000001'], type: [String], description: 'Danh sách ID media' })
  media_ids?: string[];

  @ApiPropertyOptional({ example: '018d9f10-1234-7000-8000-000000000001', description: 'ID media làm ảnh bìa' })
  cover_media_id?: string;

  @ApiPropertyOptional({ type: TripAttachmentDto, description: 'Lộ trình chuyến đi đính kèm' })
  trip_attachment?: TripAttachmentDto;
}

export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'Tiêu đề cập nhật...', description: 'Tiêu đề mới' })
  title?: string;

  @ApiPropertyOptional({ example: 'Nội dung sửa đổi...', description: 'Nội dung mới' })
  body?: string;

  @ApiPropertyOptional({ example: ['phuquoc2026'], type: [String], description: 'Hashtags mới' })
  hashtags?: string[];

  @ApiPropertyOptional({ enum: ['public', 'private'], description: 'Quyền riêng tư' })
  visibility?: PostVisibility;

  @ApiPropertyOptional({ type: [String], description: 'Danh sách ID media' })
  media_ids?: string[];

  @ApiPropertyOptional({ description: 'ID ảnh bìa' })
  cover_media_id?: string;

  @ApiPropertyOptional({ type: TripAttachmentDto, description: 'Lộ trình đính kèm' })
  trip_attachment?: TripAttachmentDto;
}

export class ListPostsQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bài lấy mỗi trang (1-50)' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor lấy từ trang trước' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'Lọc theo tác giả' })
  author_id?: string;

  @ApiPropertyOptional({ enum: ['video', 'vlog'], description: 'Lọc theo loại bài' })
  post_type?: PostType;

  @ApiPropertyOptional({ description: 'Lọc theo hashtag' })
  hashtag?: string;

  @ApiPropertyOptional({ description: 'Tìm kiếm từ khóa trong tiêu đề và nội dung' })
  keyword?: string;
}

export class ListUserPostsQueryDto {
  @ApiPropertyOptional({ default: 20, description: 'Số lượng bài lấy mỗi trang' })
  limit?: number;

  @ApiPropertyOptional({ description: 'Keyset cursor' })
  cursor?: string;

  @ApiPropertyOptional({ enum: ['all', 'draft', 'published'], default: 'all', description: 'Trạng thái bài' })
  status?: PostStatus | 'all';
}
