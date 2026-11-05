import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '@tripflix/auth';
import { SocialErrorFilter } from './social-error.filter.js';
import { ZodBody } from './http.js';
import {
  SavePostSummaryDto,
  SavePostSummaryRequestSchema,
  type SavePostSummaryRequest,
} from './dto/post-summary.dto.js';
import {
  GetPostSummaryUseCase,
  SavePostSummaryUseCase,
} from '../application/index.js';

@ApiTags('Social - AI Summary')
@Controller('v1/posts/:postId/ai-summary')
@UseFilters(SocialErrorFilter)
export class PostSummaryController {
  constructor(
    private readonly savePostSummaryUseCase: SavePostSummaryUseCase,
    private readonly getPostSummaryUseCase: GetPostSummaryUseCase,
  ) {}

  @Put()
  @ApiBearerAuth()
  @ServiceOnly('ai-service')
  @ApiOperation({
    summary: 'Lưu hoặc cập nhật kết quả tóm tắt bài viết từ AI Service (Nội bộ)',
    description: 'Chỉ cho phép ai-service với Service Token hợp lệ gọi để callback lưu kết quả tóm tắt sau khi phân tích.',
  })
  @ApiBody({ type: SavePostSummaryDto })
  @ApiResponse({ status: 200, description: 'Đã lưu tóm tắt thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ hoặc postId sai định dạng UUID' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Từ chối: Token không có quyền ai-service' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết' })
  async saveSummary(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body(new ZodBody(SavePostSummaryRequestSchema)) body: SavePostSummaryRequest,
  ) {
    return this.savePostSummaryUseCase.execute({
      postId,
      status: body.status,
      summary: body.summary,
      keyTakeaways: body.keyTakeaways,
      content: body.content,
      safety: body.safety,
      inputHash: body.inputHash,
      commentCount: body.commentCount,
      promptVersion: body.promptVersion,
      modelName: body.modelName,
      generatedAt: body.generatedAt,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Lấy kết quả tóm tắt cộng đồng của bài viết',
    description: 'Trả về bản tóm tắt và các điểm nổi bật đã lưu trong cơ sở dữ liệu (phục vụ Web/Mobile hiển thị).',
  })
  @ApiResponse({ status: 200, description: 'Thông tin tóm tắt bài viết' })
  @ApiResponse({ status: 400, description: 'postId sai định dạng UUID' })
  @ApiResponse({ status: 404, description: 'Bài viết chưa có bản tóm tắt' })
  async getSummary(@Param('postId', new ParseUUIDPipe()) postId: string) {
    const summary = await this.getPostSummaryUseCase.execute(postId);
    if (!summary) {
      throw new NotFoundException(`Bài viết ${postId} chưa có bản tóm tắt nào`);
    }
    return summary;
  }
}
