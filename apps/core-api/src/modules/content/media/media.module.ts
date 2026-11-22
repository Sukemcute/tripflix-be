import { Module } from '@nestjs/common';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import { S3ObjectStorage, type ObjectStorage } from '@tripflix/storage';
import type { CoreEnv } from '../../../platform/env.js';
import { CORE_ENV } from '../../../platform/tokens.js';
import { MediaPlaybackController } from './api/media-playback.controller.js';
import { MediaUploadController } from './api/media-upload.controller.js';
import { MediaPlaybackUseCases } from './application/media-playback.use-cases.js';
import { MediaUploadUseCases } from './application/media-upload.use-cases.js';
import {
  MEDIA_ASSET_STORE,
  MEDIA_CLOCK,
  OBJECT_STORAGE,
  PLAYBACK_COOKIE_SIGNER,
  PLAYBACK_SETTINGS,
  type MediaClock,
  type PlaybackCookieSigner,
  type PlaybackSettings,
} from './application/ports.js';
import { MediaResultUseCases } from './application/media-result.use-cases.js';
import { CloudFrontPlaybackCookieSigner } from './infra/cloudfront-playback-cookie-signer.js';
import { DrizzleMediaAssetStore } from './infra/drizzle-media-asset.store.js';
import { MediaResultConsumer } from './infra/media-result-consumer.js';
import { DEFAULT_PLAYBACK_TTL_SEC } from './domain/playback-policy.js';
import { MediaFacade } from './media.facade.js';
import { MediaFramesUseCases } from './application/media-frames.use-cases.js';

/** Phần con media của content. Test thay database và S3 bằng overrideProvider. */
@Module({
  controllers: [MediaUploadController, MediaPlaybackController],
  providers: [
    { provide: MediaFramesUseCases, inject: [buildTransactionHostToken('content')],
      useFactory: (tx: ModuleTransactionHost) => new MediaFramesUseCases(() => tx.tx) },
    MediaUploadUseCases,
    MediaResultUseCases,
    MediaResultConsumer,
    MediaPlaybackUseCases,
    MediaFacade,
    { provide: MEDIA_CLOCK, useValue: (() => new Date()) satisfies MediaClock },
    {
      provide: MEDIA_ASSET_STORE,
      inject: [buildTransactionHostToken('content')],
      // txHost.tx: transaction đang mở của @Transactional('content'), hoặc kết nối thường của tf_content.
      useFactory: (txHost: ModuleTransactionHost) => new DrizzleMediaAssetStore(() => txHost.tx),
    },
    {
      provide: OBJECT_STORAGE,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv): ObjectStorage =>
        new S3ObjectStorage({
          region: env.AWS_REGION,
          bucket: env.S3_MEDIA_BUCKET,
          keyPrefix: env.S3_KEY_PREFIX,
          cdnBaseUrl: env.MEDIA_CDN_URL ?? '',
        }),
    },
    {
      provide: PLAYBACK_SETTINGS,
      inject: [CORE_ENV],
      useFactory: (env: CoreEnv): PlaybackSettings => ({
        cdnBaseUrl: env.MEDIA_CDN_URL ?? '',
        ttlSec: env.MEDIA_PLAYBACK_TTL_SEC ?? DEFAULT_PLAYBACK_TTL_SEC,
        cookieDomain: env.MEDIA_COOKIE_DOMAIN,
      }),
    },
    {
      provide: PLAYBACK_COOKIE_SIGNER,
      inject: [CORE_ENV],
      // Chưa có khoá (máy dev, CI): không ký, endpoint trả cookie rỗng.
      useFactory: (env: CoreEnv): PlaybackCookieSigner | null =>
        env.CLOUDFRONT_KEY_PAIR_ID && env.CLOUDFRONT_PRIVATE_KEY
          ? new CloudFrontPlaybackCookieSigner({
              keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
              privateKeyPem: Buffer.from(env.CLOUDFRONT_PRIVATE_KEY, 'base64').toString('utf8'),
            })
          : null,
    },
  ],
  exports: [MediaFacade],
})
export class MediaModule {}
