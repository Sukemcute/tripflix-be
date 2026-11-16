import { BadRequestException, Body, Controller, Get, Header, Inject, NotFoundException, Param, Put } from '@nestjs/common';
import { Authenticated, CurrentUser, type AuthUser } from '@tripflix/auth';
import { z } from 'zod';
import { PostWatchWorker } from './post-watch.worker.js';

const PostWatchBodySchema = z.object({ isWatching: z.boolean() }).strict();

/** N1: bật/tắt nhận thông báo bình luận mới của bài mình đã bình luận. */
@Controller('posts')
export class PostWatchController {
  constructor(@Inject(PostWatchWorker) private readonly watches: PostWatchWorker) {}

  @Get(':postId/watch')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async get(@CurrentUser() user: AuthUser, @Param('postId') postId: string): Promise<{ isWatching: boolean; canChange: boolean }> {
    if (!z.uuid().safeParse(postId).success) throw new BadRequestException('Mã bài viết không hợp lệ');
    const isWatching = await this.watches.getWatching(user.userId, postId);
    return { isWatching: isWatching ?? false, canChange: isWatching !== null };
  }

  @Put(':postId/watch')
  @Authenticated()
  async set(
    @CurrentUser() user: AuthUser,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<{ isWatching: boolean }> {
    const parsed = PostWatchBodySchema.safeParse(body);
    if (!z.uuid().safeParse(postId).success || !parsed.success) throw new BadRequestException('Yêu cầu theo dõi bài không hợp lệ');
    // Chỉ người đã bình luận bài mới bật/tắt được, để không ai tự theo dõi bài mình không xem được.
    if (!(await this.watches.setWatching(user.userId, postId, parsed.data.isWatching))) {
      throw new NotFoundException('Bạn chưa bình luận bài viết này');
    }
    return { isWatching: parsed.data.isWatching };
  }
}
