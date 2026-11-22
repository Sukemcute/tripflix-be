import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ServiceOnly } from '@tripflix/auth';
import { SocialErrorFilter } from './social-error.filter.js';
import {
  ReconcileHeldSummariesQueryDto,
  ReconcileHeldSummariesResponseDto,
} from './dto/comment-sample.dto.js';
import { ReconcileHeldSummariesUseCase } from '../application/index.js';

@ApiTags('Social - AI Summary Internal')
@Controller('v1/internal/ai-summary')
@UseFilters(SocialErrorFilter)
export class AiSummaryInternalController {
  constructor(
    private readonly reconcileHeldSummariesUseCase: ReconcileHeldSummariesUseCase,
  ) {}

  @Get('reconciliation')
  @ApiBearerAuth()
  @ServiceOnly('ai-service')
  @ApiOperation({
    summary: 'Đối soát các bài viết có tóm tắt đang bị giữ lại do nguồn bị ẩn/xoá (TF33)',
    description:
      'Chỉ dành cho ai-service. Quét danh sách bài tóm tắt bị held để worker AI chạy tóm tắt bù khi bị sót event.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách postId cần tóm tắt bù kèm keyset cursor',
    type: ReconcileHeldSummariesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Từ chối: Token không có quyền ai-service' })
  async reconcile(@Query() query: ReconcileHeldSummariesQueryDto) {
    return this.reconcileHeldSummariesUseCase.execute({
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }
}
