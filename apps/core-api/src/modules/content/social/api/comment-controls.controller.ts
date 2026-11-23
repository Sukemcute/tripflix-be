import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, OptionalAuthenticated, OptionalCurrentUser, type AuthUser } from '@tripflix/auth';
import { Idempotent } from '@tripflix/idempotency';
import { z } from 'zod';
import { CommentControlsUseCases } from '../application/comment-controls.use-cases.js';
import { normalizeCommentKeyword } from '../domain/comment-filter.js';
import { ZodBody } from './http.js';
import { CommentMentionDto } from './dto/comment.dto.js';

export class CommentSettingsDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: [String], maxItems: 50 }) keywords!: string[];
}
export class CommentPermissionsDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() canManage!: boolean;
}
export class CreatorQueueQueryDto {
  @ApiPropertyOptional() cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) limit?: number;
}
export class CreatorDecisionDto {
  @ApiProperty({ enum: ['approve', 'reject'] }) decision!: 'approve' | 'reject';
}
export class CreatorDecisionResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() creatorReview!: string;
  @ApiProperty() status!: string;
}
export class CreatorReviewCommentDto {
  @ApiProperty({ type: [CommentMentionDto], maxItems: 10 }) mentions!: CommentMentionDto[];
  @ApiProperty() id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ type: String, nullable: true }) authorName!: string | null;
  @ApiProperty({ type: String, nullable: true }) parentCommentId!: string | null;
  @ApiProperty() body!: string;
  @ApiProperty() platformBlocked!: boolean;
  @ApiProperty() canApprove!: boolean;
  @ApiProperty() willPublish!: boolean;
  @ApiProperty({ type: String, enum: ['post_unavailable', 'parent_unavailable'], nullable: true })
  approvalBlockReason!: 'post_unavailable' | 'parent_unavailable' | null;
  @ApiProperty({ type: () => CreatorCommentContextDto, nullable: true })
  parentContext!: CreatorCommentContextDto | null;
  @ApiProperty() createdAt!: string;
}
export class CreatorCommentContextDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['reply', 'thread'] }) kind!: 'reply' | 'thread';
  @ApiProperty({ type: String, nullable: true }) authorName!: string | null;
  @ApiProperty({ type: String, nullable: true }) body!: string | null;
  @ApiProperty() unavailable!: boolean;
}
export class CreatorReviewPageDto {
  @ApiProperty({ type: [CreatorReviewCommentDto] }) items!: CreatorReviewCommentDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
const settingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    keywords: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((term) => normalizeCommentKeyword(term).length > 0, 'Từ khóa phải có chữ hoặc số'),
      )
      .max(50),
  })
  .transform((input) => ({
    ...input,
    keywords: [...new Map(input.keywords.map((term) => [normalizeCommentKeyword(term), term])).values()],
  }));

@ApiTags('Social - Comment Controls')
@Controller('v1')
export class CommentControlsController {
  constructor(private readonly controls: CommentControlsUseCases) {}

  @Get('posts/:id/comment-permissions')
  @OptionalAuthenticated()
  @ApiOkResponse({ type: CommentPermissionsDto })
  permissions(@Param('id', ParseUUIDPipe) id: string, @OptionalCurrentUser() user?: AuthUser) {
    return this.controls.permissions(id, user?.userId);
  }

  @Get('posts/:id/comment-settings')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOkResponse({ type: CommentSettingsDto })
  settings(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.controls.settings(id, user.userId);
  }

  @Patch('posts/:id/comment-settings')
  @Authenticated()
  @ApiBearerAuth()
  @Idempotent()
  @ApiBody({ type: CommentSettingsDto })
  @ApiOkResponse({ type: CommentSettingsDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(settingsSchema)) body: CommentSettingsDto,
  ) {
    return this.controls.updateSettings(id, user.userId, body);
  }

  @Get('posts/:id/filtered-comments')
  @Authenticated()
  @ApiBearerAuth()
  @ApiOkResponse({ type: CreatorReviewPageDto })
  queue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query(
      new ZodBody(
        z.object({
          cursor: z.string().max(1024).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
      ),
    )
    query: CreatorQueueQueryDto,
  ) {
    return this.controls.queue(id, user.userId, query.cursor, Number(query.limit ?? 20));
  }

  @Post('comments/:id/creator-decisions')
  @HttpCode(200)
  @Authenticated()
  @ApiBearerAuth()
  @Idempotent()
  @ApiBody({ type: CreatorDecisionDto })
  @ApiOkResponse({ type: CreatorDecisionResultDto })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(z.strictObject({ decision: z.enum(['approve', 'reject']) }))) body: CreatorDecisionDto,
  ) {
    return this.controls.decide(id, user.userId, body.decision);
  }
}
