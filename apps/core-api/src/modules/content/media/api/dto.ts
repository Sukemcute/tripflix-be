import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import {
  MAX_IMAGE_DIMENSION_PX,
  MAX_PART_COUNT,
  MEDIA_MIME_TYPES,
  isImageMimeType,
  type MediaMimeType,
} from '../domain/upload-rules.js';

const DimensionSchema = z.int().positive().max(MAX_IMAGE_DIMENSION_PX);

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
export const CreateUploadRequestSchema = z
  .object({
    mimeType: z.enum(MEDIA_MIME_TYPES),
    fileSizeBytes: z.int().positive(),
    durationSec: z.number().positive().optional(),
    widthPx: DimensionSchema.optional(),
    heightPx: DimensionSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const isImage = isImageMimeType(body.mimeType);
    if (!isImage && body.durationSec === undefined) {
      ctx.addIssue({ code: 'custom', path: ['durationSec'], message: 'Video cần thời lượng' });
    }
    if (isImage && body.durationSec !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['durationSec'], message: 'Ảnh không có thời lượng' });
    }
    if (!isImage && (body.widthPx !== undefined || body.heightPx !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['widthPx'], message: 'Kích thước chỉ dùng cho ảnh' });
    }
  });

export const ResignPartsRequestSchema = z.object({
  partNumbers: z.array(z.int().positive()).min(1).max(MAX_PART_COUNT),
});

export const CompleteUploadRequestSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.int().positive(), etag: z.string().min(1) }))
    .min(1)
    .max(MAX_PART_COUNT),
});

export class CreateUploadDto {
  @ApiProperty({ enum: MEDIA_MIME_TYPES }) mimeType!: MediaMimeType;
  @ApiProperty({ example: 25000000 }) fileSizeBytes!: number;
  @ApiProperty({
    example: 42.5,
    required: false,
    description: 'Bắt buộc với video, làm tròn lên số nguyên, tối đa 5 phút. Ảnh thì không gửi.',
  })
  durationSec?: number;
  @ApiProperty({ required: false, example: 1080, description: 'Chỉ cho ảnh: chiều rộng đọc từ file, để dàn trang.' })
  widthPx?: number;
  @ApiProperty({ required: false, example: 1350, description: 'Chỉ cho ảnh: chiều cao đọc từ file.' })
  heightPx?: number;
}

export class ResignPartsDto {
  @ApiProperty({ type: [Number], example: [2, 3] }) partNumbers!: number[];
}

export class SignedPartDto {
  @ApiProperty() partNumber!: number;
  @ApiProperty({ description: 'Link PUT ký sẵn, không gửi kèm header Authorization.' }) url!: string;
}

export class SignedPartsDto {
  @ApiProperty({ type: [SignedPartDto] }) parts!: SignedPartDto[];
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class CreatedUploadDto extends SignedPartsDto {
  @ApiProperty({ format: 'uuid' }) assetId!: string;
  @ApiProperty({ example: 10485760 }) partSizeBytes!: number;
}

export class UploadedPartDto {
  @ApiProperty() partNumber!: number;
  @ApiProperty({ description: 'Giá trị header ETag S3 trả về khi PUT phần này, giữ nguyên dấu ngoặc kép.' }) etag!: string;
}

export class CompleteUploadDto {
  @ApiProperty({ type: [UploadedPartDto], description: 'Đủ mọi phần của file, mỗi phần một lần.' })
  parts!: UploadedPartDto[];
}

export class CompletedUploadDto {
  @ApiProperty({ format: 'uuid' }) assetId!: string;
  @ApiProperty({
    enum: ['processing', 'ready'],
    description: 'Video: processing (đang chuyển mã), ready khi gọi lại lúc đã xong. Ảnh: ready ngay.',
  })
  status!: 'processing' | 'ready';
}

export class MediaErrorDto {
  @ApiProperty({ example: 'MEDIA_TOO_LARGE' }) code!: string;
  @ApiProperty() message!: string;
}
