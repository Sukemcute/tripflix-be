import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '@tripflix/auth';
import { SavePostSummaryDto } from './dto/post-summary.dto.js';
import {
  GetPostSummaryUseCase,
  SavePostSummaryUseCase,
} from '../application/index.js';

@ApiTags('Social - AI Summary')
@Controller('v1/posts/:postId/ai-summary')
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
  @ApiResponse({ status: 200, description: 'Đã lưu tóm tắt thành công' })
  @ApiResponse({ status: 403, description: 'Từ chối: Token không có quyền ai-service' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết' })
  async saveSummary(
    @Param('postId') postId: string,
    @Body() dto: SavePostSummaryDto,
  ) {
    return this.savePostSummaryUseCase.execute({
      postId,
      summary: dto.summary,
      keyTakeaways: dto.key_takeaways,
      inputHash: dto.input_hash,
      commentCount: dto.comment_count,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Lấy kết quả tóm tắt cộng đồng của bài viết',
    description: 'Trả về bản tóm tắt và các điểm nổi bật đã lưu trong cơ sở dữ liệu (phục vụ Web/Mobile hiển thị).',
  })
  @ApiResponse({ status: 200, description: 'Thông tin tóm tắt bài viết' })
  @ApiResponse({ status: 404, description: 'Bài viết chưa có bản tóm tắt' })
  async getSummary(@Param('postId') postId: string) {
    const summary = await this.getPostSummaryUseCase.execute(postId);
    if (!summary) {
      throw new NotFoundException(`Bài viết ${postId} chưa có bản tóm tắt nào`);
    }
    return summary;
  }
}
