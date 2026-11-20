import { Controller, Header, HttpCode, HttpStatus, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MediaPlaybackUseCases } from '../application/media-playback.use-cases.js';
import { PLAYBACK_SETTINGS, type PlaybackSettings } from '../application/ports.js';
import { PlaybackSessionDto } from './dto.js';

/** Khách chưa đăng nhập cũng xem Reels, nên không cần đăng nhập. Giới hạn tần suất do Traefik làm. */
@ApiTags('media')
@Controller('media/playback-session')
export class MediaPlaybackController {
  constructor(
    @Inject(MediaPlaybackUseCases) private readonly playback: MediaPlaybackUseCases,
    @Inject(PLAYBACK_SETTINGS) private readonly settings: PlaybackSettings,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cấp cookie xem video trên CDN',
    description:
      'Web: gọi kèm credentials (có Origin), trình duyệt nhận Set-Cookie cho tên miền media. App: không nhận Set-Cookie, ghép `cookies` thành header Cookie khi phát video.',
  })
  @ApiQuery({ name: 'resourcePath', required: false, description: 'Tiền tố đường dẫn tài nguyên cần giới hạn (ví dụ: videos/reel-123)' })
  @ApiOkResponse({ type: PlaybackSessionDto })
  createSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('resourcePath') resourcePath?: string,
  ): PlaybackSessionDto {
    const session = this.playback.createSession(resourcePath);
    const { cookieDomain } = this.settings;
    // Chỉ trình duyệt (luôn gửi Origin khi gọi API khác tên miền) mới nhận Set-Cookie. fetch của app không gửi Origin
    // nhưng vẫn tự lưu Set-Cookie vào kho cookie của máy; player lại gửi thêm bản đó cạnh header Cookie app gắn,
    // hai bản lệch nhau thì CloudFront có thể đọc nhầm bản cũ.
    if (cookieDomain && session.expiresAt && req.get('origin')) {
      // Cookie hết hạn đúng lúc chữ ký hết hạn, không tính lại theo giờ lúc gửi.
      const expires = new Date(session.expiresAt);
      for (const [name, value] of Object.entries(session.cookies)) {
        // Trình duyệt tự gửi cookie khi tải video từ media.<tên miền>; JavaScript của trang không cần đọc.
        res.cookie(name, value, {
          domain: cookieDomain,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          expires,
          encode: String,
        });
      }
    }
    return session;
  }
}
