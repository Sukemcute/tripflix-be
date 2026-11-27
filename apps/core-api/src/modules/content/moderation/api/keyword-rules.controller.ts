import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '@tripflix/auth';
import { Idempotent } from '@tripflix/idempotency';
import { z } from 'zod';
import type { moderationKeywordRules } from '../../db/schema/index.js';
import { ZodBody } from '../../social/api/http.js';
import { normalizeCommentKeyword } from '../../social/domain/comment-filter.js';
import { KeywordRulesUseCases } from '../application/keyword-rules.use-cases.js';
import { BUILT_IN_RULE_PATTERNS } from '../domain/rules.js';

const keyword = z.string().trim().min(1).max(120).refine(
  (text) => normalizeCommentKeyword(text).length > 0,
  'Từ khóa phải có chữ hoặc số',
);
const createSchema = z.strictObject({ keyword, enabled: z.boolean() });
const updateSchema = createSchema.partial().refine(
  ({ keyword, enabled }) => keyword !== undefined || enabled !== undefined,
  'Cần ít nhất một thay đổi',
);

export class CreateModerationKeywordRuleDto {
  @ApiProperty({ minLength: 1, maxLength: 120 }) keyword!: string;
  @ApiProperty() enabled!: boolean;
}

export class UpdateModerationKeywordRuleDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 }) keyword?: string;
  @ApiPropertyOptional() enabled?: boolean;
}

export class ModerationKeywordRuleDto extends CreateModerationKeywordRuleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class BuiltInModerationRuleDto {
  @ApiProperty() code!: string;
  @ApiProperty({ type: [String] }) patterns!: string[];
}

function toDto(rule: typeof moderationKeywordRules.$inferSelect): ModerationKeywordRuleDto {
  return { id: rule.id, keyword: rule.keyword, enabled: rule.enabled, updatedAt: rule.updatedAt.toISOString() };
}

@ApiTags('Moderation - Admin')
@ApiBearerAuth()
@Roles('superadmin')
@Controller('v1/admin/moderation/keyword-rules')
export class AdminModerationKeywordRulesController {
  constructor(@Inject(KeywordRulesUseCases) private readonly rules: KeywordRulesUseCases) {}

  @Get()
  @ApiOkResponse({ type: ModerationKeywordRuleDto, isArray: true })
  async list(): Promise<ModerationKeywordRuleDto[]> {
    return (await this.rules.list()).map(toDto);
  }

  @Get('built-in')
  @ApiOkResponse({ type: BuiltInModerationRuleDto, isArray: true })
  listBuiltIn(): BuiltInModerationRuleDto[] {
    return BUILT_IN_RULE_PATTERNS;
  }

  @Post()
  @Idempotent()
  @ApiBody({ type: CreateModerationKeywordRuleDto })
  @ApiCreatedResponse({ type: ModerationKeywordRuleDto })
  async create(
    @Body(new ZodBody(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<ModerationKeywordRuleDto> {
    return toDto(await this.rules.create(body, user.userId));
  }

  @Patch(':id')
  @Idempotent()
  @ApiBody({ type: UpdateModerationKeywordRuleDto })
  @ApiOkResponse({ type: ModerationKeywordRuleDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBody(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentUser() user: AuthUser,
  ): Promise<ModerationKeywordRuleDto> {
    return toDto(await this.rules.update(id, body, user.userId));
  }
}
