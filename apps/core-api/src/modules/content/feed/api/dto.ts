import { ApiProperty } from '@nestjs/swagger';
import { MEDIA_QUALITY_LEVELS, type MediaAspect, type MediaQualityLevel } from '@tripflix/contracts';
import { z } from 'zod';
import { TripAttachmentDto } from '../../social/api/dto/post.dto.js';
import { FEED_TABS } from '../application/feed.use-cases.js';
import { decodeFeedCursor, type FeedCursor } from '../domain/feed-cursor.js';

export const FEED_DEFAULT_LIMIT = 10;
export const FEED_MAX_LIMIT = 20;

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
export const FeedQuerySchema = z
  .object({
    // Chưa có tab following. Báo lỗi với tab khác, không âm thầm trả nhầm nội dung.
    tab: z.enum(FEED_TABS).default('for_you'),
    limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
    author_id: z.uuid().optional(),
    // Mở Reels từ kết quả tìm kiếm hay link: "a,b,c", trả thẻ theo đúng thứ tự này, bỏ qua bài không xem được.
    post_ids: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.uuid()).min(1).max(FEED_MAX_LIMIT))
      .optional(),
    cursor: z
      .string()
      .transform((value, ctx): FeedCursor => {
        const cursor = decodeFeedCursor(value);
        if (!cursor) {
          ctx.addIssue({ code: 'custom', message: 'Cursor không hợp lệ' });
          return z.NEVER;
        }
        return cursor;
      })
      .optional(),
    // z.coerce.boolean() biến chuỗi "false" thành true nên nhận đúng hai giá trị chữ.
    saved: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(false),
  })
  .superRefine((query, ctx) => {
    // Lấy theo id không phân trang, không lọc thêm: ghép với các tham số này thì không rõ ý người gọi.
    if (query.post_ids && (query.cursor || query.saved || query.author_id)) {
      ctx.addIssue({ code: 'custom', path: ['post_ids'], message: 'post_ids không dùng chung với cursor, saved, author_id' });
    }
    if (query.saved && query.tab === 'hot') {
      ctx.addIssue({ code: 'custom', path: ['saved'], message: 'saved chỉ dùng với tab for_you' });
    }
    // Cursor của tab này dùng ở tab kia sẽ cắt danh sách sai vị trí.
    if (
      query.cursor &&
      ((query.tab === 'hot') !== (query.cursor.score !== undefined) ||
        (query.tab === 'hot' && query.cursor.rank !== undefined))
    ) {
      ctx.addIssue({ code: 'custom', path: ['cursor'], message: 'Cursor không thuộc tab này' });
    }
  });

class FeedAuthorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Chưa có dữ liệu, hiện luôn là null' }) name!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Chưa có dữ liệu, hiện luôn là null' }) avatarUrl!:
    | string
    | null;
  @ApiProperty({ description: 'Chưa có dữ liệu, hiện luôn là false' }) isKol!: boolean;
}

class FeedPostersDto {
  @ApiProperty() w360!: string;
  @ApiProperty() w540!: string;
  @ApiProperty() w720!: string;
}

class FeedVideoDto {
  @ApiProperty({ description: 'master.m3u8 trên CloudFront' }) hlsUrl!: string;
  @ApiProperty({ type: FeedPostersDto, description: 'Chọn cỡ nhỏ nhất không nhỏ hơn chiều rộng hiển thị' })
  posters!: FeedPostersDto;
  @ApiProperty() durationSec!: number;
  @ApiProperty({ enum: ['9:16', '16:9', '1:1'] }) aspect!: MediaAspect;
  @ApiProperty({ enum: MEDIA_QUALITY_LEVELS, isArray: true }) levels!: MediaQualityLevel[];
}

class FeedCountsDto {
  @ApiProperty() likes!: number;
  @ApiProperty() comments!: number;
  @ApiProperty() saves!: number;
  @ApiProperty() shares!: number;
}

class FeedViewerStateDto {
  @ApiProperty() liked!: boolean;
  @ApiProperty() saved!: boolean;
}

class FeedReasonDto {
  @ApiProperty() code!: string;
  @ApiProperty() text!: string;
}

export class FeedCardDto {
  @ApiProperty({ format: 'uuid' }) postId!: string;
  @ApiProperty({ type: FeedAuthorDto }) author!: FeedAuthorDto;
  @ApiProperty({ type: FeedVideoDto }) video!: FeedVideoDto;
  @ApiProperty() title!: string;
  @ApiProperty() caption!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Chưa có dữ liệu, hiện luôn là null' }) region!:
    | string
    | null;
  @ApiProperty({ type: String, isArray: true }) tags!: string[];
  @ApiProperty({ type: String, isArray: true, description: 'Chưa có dữ liệu, hiện luôn rỗng' })
  linkedProductIds!: string[];
  @ApiProperty({ type: TripAttachmentDto, nullable: true, required: false })
  tripAttachment?: TripAttachmentDto | null;
  @ApiProperty({ type: FeedCountsDto }) counts!: FeedCountsDto;
  @ApiProperty({ type: FeedViewerStateDto, nullable: true, description: 'null với khách' })
  viewerState!: FeedViewerStateDto | null;
  @ApiProperty({ type: FeedReasonDto, nullable: true, description: 'Chưa xếp hạng, hiện luôn là null' })
  reason!: FeedReasonDto | null;
}

export class FeedPageDto {
  @ApiProperty({ type: FeedCardDto, isArray: true }) items!: FeedCardDto[];
  @ApiProperty({ type: String, nullable: true, description: 'null nghĩa là hết bài' }) nextCursor!: string | null;
}
