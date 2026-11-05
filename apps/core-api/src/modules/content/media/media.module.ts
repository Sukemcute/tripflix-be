import { Module } from '@nestjs/common';
import { buildTransactionHostToken, type ModuleTransactionHost } from '@tripflix/db';
import { S3ObjectStorage, type ObjectStorage } from '@tripflix/storage';
import type { CoreEnv } from '../../../platform/env.js';
import { CORE_ENV } from '../../../platform/tokens.js';
import { MediaUploadController } from './api/media-upload.controller.js';
import { MediaUploadUseCases } from './application/media-upload.use-cases.js';
import { MEDIA_ASSET_STORE, MEDIA_CLOCK, OBJECT_STORAGE, type MediaClock } from './application/ports.js';
import { ContentOutboxRelay } from './infra/content-outbox-relay.js';
import { DrizzleMediaAssetStore } from './infra/drizzle-media-asset.store.js';

/** Phần con media của content. Test thay database và S3 bằng overrideProvider. */
@Module({
  controllers: [MediaUploadController],
  providers: [
    MediaUploadUseCases,
    ContentOutboxRelay,
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
  ],
})
export class MediaModule {}
