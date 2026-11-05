import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

const TakeawaySchema = z.string().trim().min(1).max(500);
const SummaryObjectSchema = z.record(z.string().max(64), z.unknown());

export const SavePostSummaryRequestSchema = z
  .object({
    status: z.enum(['no_comments', 'insufficient_data', 'ready', 'failed']).optional().default('ready'),
    summary: z.string().optional().nullable(),
    keyTakeaways: z.array(TakeawaySchema).max(20).optional().default([]),
    content: SummaryObjectSchema.optional().nullable(),
    safety: SummaryObjectSchema.optional().nullable(),
    inputHash: z.string().max(128).optional().nullable(),
    commentCount: z.number().int().min(0).max(1_000_000).optional().default(0),
    promptVersion: z.string().max(32).optional().nullable(),
    modelName: z.string().max(64).optional().nullable(),
    generatedAt: z.string().datetime().optional().default(() => new Date().toISOString()),
  })
  .refine(
    (data) => {
      const status = data.status ?? 'ready';
      if (status === 'ready') {
        return typeof data.summary === 'string' && data.summary.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Nội dung tóm tắt (summary) không được để trống khi trạng thái là ready',
      path: ['summary'],
    },
  )
  .transform((data) => ({
    status: data.status,
    summary: data.summary ? data.summary.trim() : null,
    keyTakeaways: data.keyTakeaways,
    content: data.content ?? null,
    safety: data.safety ?? null,
    inputHash: data.inputHash ?? null,
    commentCount: data.commentCount,
    promptVersion: data.promptVersion ?? null,
    modelName: data.modelName ?? null,
    generatedAt: new Date(data.generatedAt),
  }));

export type SavePostSummaryRequest = z.infer<typeof SavePostSummaryRequestSchema>;

export class SavePostSummaryDto {
  @ApiPropertyOptional({
    enum: ['no_comments', 'insufficient_data', 'ready', 'failed'],
    default: 'ready',
    description: 'Trạng thái tóm tắt bài viết',
  })
  status?: 'no_comments' | 'insufficient_data' | 'ready' | 'failed';

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Bài viết chia sẻ trải nghiệm du lịch Ninh Bình với nhiều mẹo thực tế...',
    description: 'Nội dung tóm tắt tiếng Việt sinh từ AI (bắt buộc khi status là ready)',
  })
  summary?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['Nên đi thuyền Tràng An lúc 7h sáng', 'Emeralda Resort có dịch vụ chu đáo'],
    description: 'Các điểm nổi bật đúc kết từ thảo luận cộng đồng',
  })
  keyTakeaways?: string[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'Bản băm hash của tập bình luận đã dùng để tóm tắt',
  })
  inputHash?: string | null;

  @ApiPropertyOptional({
    type: Number,
    example: 25,
    description: 'Số lượng bình luận tại thời điểm thực hiện tóm tắt',
  })
  commentCount?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Chi tiết phân tích cấu trúc: khen/chê, video vs thực tế, trích dẫn commentId',
  })
  content?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Cờ và đánh giá an toàn: rủi ro, tin đồn, yêu cầu kiểm duyệt',
  })
  safety?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'v1.0',
    description: 'Phiên bản prompt',
  })
  promptVersion?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'gemini-1.5-flash',
    description: 'Tên mô hình LLM',
  })
  modelName?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-05T14:00:00.000Z',
    description: 'Thời điểm sinh kết quả',
  })
  generatedAt?: string | null;
}

export class PostSummaryResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '018d9f20-0000-7000-8000-000000000001',
    description: 'Mã bài đăng',
  })
  postId!: string;

  @ApiProperty({
    enum: ['no_comments', 'insufficient_data', 'ready', 'failed'],
    example: 'ready',
    description: 'Trạng thái tóm tắt',
  })
  status!: 'no_comments' | 'insufficient_data' | 'ready' | 'failed';

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Bài viết chia sẻ trải nghiệm du lịch Ninh Bình...',
    description: 'Nội dung tóm tắt tiếng Việt sinh từ AI',
  })
  summary?: string | null;

  @ApiProperty({
    type: [String],
    example: ['Nên đi thuyền Tràng An lúc 7h sáng'],
    description: 'Các điểm nổi bật từ thảo luận cộng đồng',
  })
  keyTakeaways!: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Chi tiết phân tích cấu trúc: khen/chê, video vs thực tế',
  })
  content?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Cờ và đánh giá an toàn',
  })
  safety?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'Bản băm của tập bình luận dùng để tóm tắt',
  })
  inputHash?: string | null;

  @ApiProperty({
    type: Number,
    example: 25,
    description: 'Số lượng bình luận tại thời điểm tóm tắt',
  })
  commentCountAtSummary!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'v1.0',
    description: 'Phiên bản prompt',
  })
  promptVersion?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'gemini-1.5-flash',
    description: 'Tên mô hình LLM',
  })
  modelName?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-05T14:00:00.000Z',
    description: 'Thời điểm sinh kết quả',
  })
  generatedAt?: string | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'Cờ cảnh báo bản tóm tắt đã cũ so với thảo luận hiện tại (số bình luận bài viết đã thay đổi)',
  })
  isStale!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T14:00:00.000Z',
    description: 'Thời điểm tạo bản tóm tắt',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-05T14:00:00.000Z',
    description: 'Thời điểm cập nhật bản tóm tắt',
  })
  updatedAt!: string;
}
