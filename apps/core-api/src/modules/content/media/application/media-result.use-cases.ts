import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ContentMediaFailedV1,
  ContentMediaReadyV1,
  MediaRenditionCompletedV1,
  MediaTranscodeFailedV1,
} from '@tripflix/contracts';
import { Transactional } from '@tripflix/db';
import { MEDIA_ASSET_STORE, type MediaAssetStore } from './ports.js';

// Video phát được từ mức này, nên đây là lúc chuyển ready. Các mức cao hơn chỉ thêm lựa chọn chất lượng.
const PLAYABLE_LEVEL = 360;

/**
 * Nhận kết quả từ video-worker. Worker có thể báo lại, nên mọi bước đều an toàn khi chạy lại: thêm mức
 * bỏ qua nếu đã có, đổi trạng thái có điều kiện, chỉ lần đổi được mới phát sự kiện.
 */
@Injectable()
export class MediaResultUseCases {
  private readonly logger = new Logger('MediaResultUseCases');

  constructor(@Inject(MEDIA_ASSET_STORE) private readonly store: MediaAssetStore) {}

  @Transactional('content')
  async recordRendition({ assetId, level, hlsPrefix, durationSec, aspect }: MediaRenditionCompletedV1): Promise<void> {
    if (!(await this.hasAsset(assetId))) return;
    await this.store.insertRendition(assetId, level);
    if (level !== PLAYABLE_LEVEL) return;

    const ownerId = await this.store.markReady({ assetId, hlsPrefix, durationSec, aspect });
    if (ownerId === null) return;
    const payload: ContentMediaReadyV1 = { assetId, ownerId, durationSec };
    await this.store.outbox.add({ type: 'content.media.ready', userId: ownerId, payload });
  }

  @Transactional('content')
  async recordFailure({ assetId, reason }: MediaTranscodeFailedV1): Promise<void> {
    if (!(await this.hasAsset(assetId))) return;
    // Đã có mức phát được thì video vẫn xem được, chỉ thiếu chất lượng cao, nên giữ ready.
    if (await this.store.hasRendition(assetId, PLAYABLE_LEVEL)) {
      await this.store.recordError(assetId, reason);
      return;
    }
    const ownerId = await this.store.markFailed(assetId, reason);
    if (ownerId === null) {
      // Replica khác vừa chuyển ready giữa hai bước trên, hoặc video đã failed: vẫn giữ lại lỗi để xem lại.
      await this.store.recordError(assetId, reason);
      return;
    }
    const payload: ContentMediaFailedV1 = { assetId, ownerId, reason };
    await this.store.outbox.add({ type: 'content.media.failed', userId: ownerId, payload });
  }

  /** Kết quả của video không có trong database thì thử lại cũng vô ích, nên bỏ qua để không kẹt hàng đợi. */
  private async hasAsset(assetId: string): Promise<boolean> {
    if ((await this.store.findStatus(assetId)) !== null) return true;
    this.logger.warn({ assetId }, 'Nhận kết quả của video không tồn tại, bỏ qua');
    return false;
  }
}
