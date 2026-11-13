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
import { ServiceOnly, type AuthUser } from '@tripflix/auth';
import { OptionalAuthenticated, OptionalCurrentUser } from './optional-auth.guard.js';
import { SocialErrorFilter } from './social-error.filter.js';
import { ZodBody } from './http.js';
import {
  MarkPostSummaryCheckedDto,
  MarkPostSummaryCheckedRequestSchema,
  MarkPostSummaryCheckedResponseDto,
  PostSummaryResponseDto,
  SavePostSummaryDto,
  SavePostSummaryRequestSchema,
  type MarkPostSummaryCheckedRequest,
  type SavePostSummaryRequest,
} from './dto/post-summary.dto.js';
import {
  GetPostSummaryUseCase,
  MarkPostSummaryCheckedUseCase,
  SavePostSummaryUseCase,
} from '../application/index.js';

@ApiTags('Social - AI Summary')
@Controller('v1/posts/:postId/ai-summary')
@UseFilters(SocialErrorFilter)
export class PostSummaryController {
  constructor(
    private readonly savePostSummaryUseCase: SavePostSummaryUseCase,
    private readonly getPostSummaryUseCase: GetPostSummaryUseCase,
    private readonly markPostSummaryCheckedUseCase: MarkPostSummaryCheckedUseCase,
  ) {}

  @Put()
  @ApiBearerAuth()
  @ServiceOnly('ai-service')
  @ApiOperation({
    summary: 'Lưu hoặc cập nhật kết quả tóm tắt bài viết từ AI Service (Nội bộ)',
    description:
      'Chỉ cho phép ai-service với Service Token hợp lệ gọi để callback lưu kết quả tóm tắt sau khi phân tích.',
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
      sourceCommentIds: body.sourceCommentIds,
      commentCount: body.commentCount,
      promptVersion: body.promptVersion,
      modelName: body.modelName,
      generatedAt: body.generatedAt,
    });
  }

  @Put('checked')
  @ApiBearerAuth()
  @ServiceOnly('ai-service')
  @ApiOperation({
    summary: 'AI báo đã kiểm lại, đầu vào không đổi (Nội bộ)',
    description:
      'Worker chạy lại nhưng inputHash trùng bản đang lưu nên không gọi LLM, không lưu bản mới. ' +
      'Core ghi checkedAt và số bình luận hiện tại để isStale không bị kẹt. Chỉ cập nhật khi inputHash khớp ' +
      'và checkedAt mới hơn generatedAt lẫn checkedAt đang có; gửi lại nhiều lần không sao.',
  })
  @ApiBody({ type: MarkPostSummaryCheckedDto })
  @ApiResponse({ status: 200, description: 'Đã xử lý', type: MarkPostSummaryCheckedResponseDto })
  @ApiResponse({ status: 400, description: 'Dữ liệu gửi lên không hợp lệ hoặc postId sai định dạng UUID' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Từ chối: Token không có quyền ai-service' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bài viết' })
  async markChecked(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body(new ZodBody(MarkPostSummaryCheckedRequestSchema)) body: MarkPostSummaryCheckedRequest,
  ) {
    return this.markPostSummaryCheckedUseCase.execute({ postId, ...body });
  }

  @Get()
  @OptionalAuthenticated()
  @ApiOperation({
    summary: 'Lấy kết quả tóm tắt cộng đồng của bài viết',
    description:
      'Trả về bản tóm tắt và các điểm nổi bật đã lưu trong cơ sở dữ liệu (phục vụ Web/Mobile hiển thị).',
  })
  @ApiResponse({ status: 200, description: 'Thông tin tóm tắt bài viết', type: PostSummaryResponseDto })
  @ApiResponse({ status: 400, description: 'postId sai định dạng UUID' })
  @ApiResponse({ status: 404, description: 'Bài viết chưa có bản tóm tắt hoặc không có quyền xem' })
  async getSummary(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @OptionalCurrentUser() user?: AuthUser,
  ) {
    const isStaff = user?.role === 'superadmin' || user?.role === 'moderator';
    const summary = await this.getPostSummaryUseCase.execute({
      postId,
      viewerId: user?.userId,
      isStaff,
    });
    if (!summary) {
      throw new NotFoundException(`Bài viết ${postId} chưa có bản tóm tắt nào`);
    }
    return summary;
  }
}
