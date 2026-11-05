import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const SavePostSummaryRequestSchema = z
  .object({
    status: z.enum(['no_comments', 'insufficient_data', 'ready', 'failed']).optional().default('ready'),
    summary: z.string().optional().nullable(),
    keyTakeaways: z.array(z.string()).optional().default([]),
    content: z.record(z.string(), z.unknown()).optional().nullable(),
    safety: z.record(z.string(), z.unknown()).optional().nullable(),
    inputHash: z.string().max(128).optional().nullable(),
    commentCount: z.number().int().min(0).optional().default(0),
    promptVersion: z.string().max(32).optional().nullable(),
    modelName: z.string().max(64).optional().nullable(),
    generatedAt: z.string().datetime().optional().nullable(),
    // Hỗ trợ tương thích ngược nếu client cũ gửi snake_case
    key_takeaways: z.array(z.string()).optional(),
    input_hash: z.string().max(128).optional().nullable(),
    comment_count: z.number().int().min(0).optional(),
  })
  .transform((data) => ({
    status: data.status,
    summary: data.summary ?? null,
    keyTakeaways: data.keyTakeaways.length > 0 ? data.keyTakeaways : (data.key_takeaways ?? []),
    content: data.content ?? null,
    safety: data.safety ?? null,
    inputHash: data.inputHash ?? data.input_hash ?? null,
    commentCount: data.commentCount || (data.comment_count ?? 0),
    promptVersion: data.promptVersion ?? null,
    modelName: data.modelName ?? null,
    generatedAt: data.generatedAt ? new Date(data.generatedAt) : null,
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
    example: 'Bài viết chia sẻ trải nghiệm du lịch Ninh Bình với nhiều mẹo thực tế...',
    description: 'Nội dung tóm tắt tiếng Việt sinh từ AI (bắt buộc khi status là ready)',
  })
  summary?: string | null;

  @ApiPropertyOptional({
    example: ['Nên đi thuyền Tràng An lúc 7h sáng', 'Emeralda Resort có dịch vụ chu đáo'],
    description: 'Các điểm nổi bật đúc kết từ thảo luận cộng đồng',
    type: [String],
  })
  keyTakeaways?: string[];

  @ApiPropertyOptional({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'Bản băm hash của tập bình luận đã dùng để tóm tắt',
  })
  inputHash?: string | null;

  @ApiPropertyOptional({
    example: 25,
    description: 'Số lượng bình luận tại thời điểm thực hiện tóm tắt',
  })
  commentCount?: number;

  @ApiPropertyOptional({
    description: 'Chi tiết phân tích cấu trúc: khen/chê, video vs thực tế, trích dẫn commentId',
  })
  content?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Cờ và đánh giá an toàn: rủi ro, tin đồn, yêu cầu kiểm duyệt',
  })
  safety?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'v1.0', description: 'Phiên bản prompt' })
  promptVersion?: string | null;

  @ApiPropertyOptional({ example: 'gemini-1.5-flash', description: 'Tên mô hình LLM' })
  modelName?: string | null;

  @ApiPropertyOptional({ example: '2026-11-05T14:00:00Z', description: 'Thời điểm sinh kết quả' })
  generatedAt?: string | null;
}
