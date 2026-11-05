import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { MAX_PART_COUNT, MEDIA_MIME_TYPES, type MediaMimeType } from '../domain/upload-rules.js';

// Schema zod để kiểm dữ liệu vào; class bên dưới chỉ để Swagger sinh contracts/openapi.
export const CreateUploadRequestSchema = z.object({
  mimeType: z.enum(MEDIA_MIME_TYPES),
  fileSizeBytes: z.int().positive(),
  durationSec: z.number().positive(),
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
  @ApiProperty({ example: 42.5, description: 'Làm tròn lên số nguyên. Tối đa 5 phút.' }) durationSec!: number;
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
  @ApiProperty({ enum: ['processing', 'ready'], description: 'ready khi gọi lại lúc video đã chuyển mã xong.' })
  status!: 'processing' | 'ready';
}

export class MediaErrorDto {
  @ApiProperty({ example: 'MEDIA_TOO_LARGE' }) code!: string;
  @ApiProperty() message!: string;
}
