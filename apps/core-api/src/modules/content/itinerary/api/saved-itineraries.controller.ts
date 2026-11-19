import {
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
  type ArgumentsHost,
  type PipeTransform,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import type { z } from 'zod';
import { EmptyItineraryError, SavedItineraryNotFoundError, SavedItineraryUseCases } from '../application/saved-itinerary.use-cases.js';
import {
  ListItinerariesQuerySchema,
  SavedItineraryDto,
  SavedItineraryListDto,
  SaveItineraryRequestDto,
  SaveItineraryRequestSchema,
  toSavedItineraryDto,
  UpdateItineraryRequestDto,
  UpdateItineraryRequestSchema,
} from './saved-itinerary.dto.js';

class ZodBody<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new BadRequestException({
      message: 'Dữ liệu gửi lên không hợp lệ',
      errors: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
}

@Catch(SavedItineraryNotFoundError, EmptyItineraryError)
class SavedItineraryErrorFilter extends BaseExceptionFilter {
  override catch(error: Error, host: ArgumentsHost) {
    super.catch(error instanceof SavedItineraryNotFoundError ? new NotFoundException(error.message) : new BadRequestException(error.message), host);
  }
}

/** Lộ trình đã lưu của tôi (TF105): bản sao theo Ngày 1..N từ reel, Tripi hoặc màn tự lên lộ trình. */
@ApiTags('Content - Saved itineraries')
@ApiBearerAuth()
@Authenticated()
@Controller('v1/me/itineraries')
@UseFilters(SavedItineraryErrorFilter)
export class SavedItinerariesController {
  constructor(@Inject(SavedItineraryUseCases) private readonly itineraries: SavedItineraryUseCases) {}

  @Get()
  @ApiQuery({ name: 'postId', required: false, description: 'Chỉ lấy lộ trình đã lưu từ reel này' })
  @ApiOkResponse({ type: SavedItineraryListDto, description: '?postId= để biết reel này đã lưu chưa' })
  async list(@CurrentUser() user: AuthUser, @Query(new ZodBody(ListItinerariesQuerySchema)) query: z.infer<typeof ListItinerariesQuerySchema>): Promise<SavedItineraryListDto> {
    const rows = await this.itineraries.list(user.userId, { sourcePostId: query.postId });
    return { itineraries: rows.map(toSavedItineraryDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: SavedItineraryDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<SavedItineraryDto> {
    return toSavedItineraryDto(await this.itineraries.get(user.userId, id));
  }

  @Post()
  @ApiBody({ type: SaveItineraryRequestDto })
  @ApiCreatedResponse({ type: SavedItineraryDto, description: 'Reel đã lưu rồi thì trả lại bản cũ, không tạo trùng' })
  async save(@CurrentUser() user: AuthUser, @Body(new ZodBody(SaveItineraryRequestSchema)) body: z.infer<typeof SaveItineraryRequestSchema>): Promise<SavedItineraryDto> {
    return toSavedItineraryDto(await this.itineraries.save(user.userId, body));
  }

  @Patch(':id')
  @ApiBody({ type: UpdateItineraryRequestDto })
  @ApiOkResponse({ type: SavedItineraryDto })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBody(UpdateItineraryRequestSchema)) body: z.infer<typeof UpdateItineraryRequestSchema>,
  ): Promise<SavedItineraryDto> {
    return toSavedItineraryDto(await this.itineraries.update(user.userId, id, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.itineraries.remove(user.userId, id);
  }
}
