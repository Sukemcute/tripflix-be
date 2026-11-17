import { Inject, Injectable } from '@nestjs/common';
import { buildPlaybackPolicy, buildPlaybackResource } from '../domain/playback-policy.js';
import {
  MEDIA_CLOCK,
  PLAYBACK_COOKIE_SIGNER,
  PLAYBACK_SETTINGS,
  type MediaClock,
  type PlaybackCookieSigner,
  type PlaybackSettings,
} from './ports.js';

export interface PlaybackSession {
  /** Tên cookie và giá trị. Rỗng khi server chưa cấu hình khoá ký (máy dev): phát video như cũ. */
  cookies: Record<string, string>;
  /** ISO 8601. Null khi không ký. */
  expiresAt: string | null;
}

/**
 * Cấp cookie xem video. CloudFront chỉ trả file video (`*.m3u8`, `*.ts`) khi request có cookie ký hợp lệ,
 * nên link video bị chép ra ngoài sẽ hết dùng được khi cookie hết hạn.
 */
@Injectable()
export class MediaPlaybackUseCases {
  constructor(
    @Inject(PLAYBACK_COOKIE_SIGNER) private readonly signer: PlaybackCookieSigner | null,
    @Inject(PLAYBACK_SETTINGS) private readonly settings: PlaybackSettings,
    @Inject(MEDIA_CLOCK) private readonly now: MediaClock,
  ) {}

  createSession(): PlaybackSession {
    if (!this.signer || !this.settings.cdnBaseUrl) return { cookies: {}, expiresAt: null };
    const expiresAt = new Date(this.now().getTime() + this.settings.ttlSec * 1000);
    const policy = buildPlaybackPolicy(buildPlaybackResource(this.settings.cdnBaseUrl), expiresAt);
    return { cookies: this.signer.signCookies(policy), expiresAt: expiresAt.toISOString() };
  }
}
