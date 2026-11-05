import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseFilters } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { z } from 'zod';
import { MediaUploadUseCases } from '../application/media-upload.use-cases.js';
import {
  CompleteUploadDto,
  CompleteUploadRequestSchema,
  CompletedUploadDto,
  CreateUploadDto,
  CreateUploadRequestSchema,
  CreatedUploadDto,
  MediaErrorDto,
  ResignPartsDto,
  ResignPartsRequestSchema,
  SignedPartsDto,
} from './dto.js';
import { MediaErrorFilter, ZodBody } from './http.js';

@ApiTags('media')
@ApiBearerAuth()
@Authenticated()
@Controller('media/uploads')
@UseFilters(MediaErrorFilter)
export class MediaUploadController {
  constructor(@Inject(MediaUploadUseCases) private readonly uploads: MediaUploadUseCases) {}

  @Post()
  @ApiBody({ type: CreateUploadDto })
  @ApiCreatedResponse({ type: CreatedUploadDto })
  @ApiUnprocessableEntityResponse({ type: MediaErrorDto, description: 'MEDIA_TOO_LARGE' })
  createUpload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(CreateUploadRequestSchema)) body: z.infer<typeof CreateUploadRequestSchema>,
  ) {
    return this.uploads.createUpload(user.userId, body);
  }

  @Post(':assetId/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ResignPartsDto })
  @ApiOkResponse({ type: SignedPartsDto })
  @ApiNotFoundResponse({ type: MediaErrorDto, description: 'MEDIA_NOT_FOUND' })
  @ApiConflictResponse({ type: MediaErrorDto, description: 'MEDIA_UPLOAD_NOT_ACTIVE' })
  resignParts(
    @CurrentUser() user: AuthUser,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body(new ZodBody(ResignPartsRequestSchema)) body: z.infer<typeof ResignPartsRequestSchema>,
  ) {
    return this.uploads.resignParts(user.userId, assetId, body.partNumbers);
  }

  @Post(':assetId/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: CompleteUploadDto })
  @ApiAcceptedResponse({ type: CompletedUploadDto })
  @ApiNotFoundResponse({ type: MediaErrorDto, description: 'MEDIA_NOT_FOUND' })
  @ApiConflictResponse({ type: MediaErrorDto, description: 'MEDIA_UPLOAD_INCOMPLETE, MEDIA_UPLOAD_NOT_ACTIVE' })
  @ApiGoneResponse({ type: MediaErrorDto, description: 'MEDIA_UPLOAD_EXPIRED' })
  completeUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body(new ZodBody(CompleteUploadRequestSchema)) body: z.infer<typeof CompleteUploadRequestSchema>,
  ) {
    return this.uploads.completeUpload(user.userId, assetId, body.parts);
  }
}
