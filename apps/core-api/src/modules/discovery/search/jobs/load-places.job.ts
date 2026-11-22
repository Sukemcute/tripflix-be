import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { PLACES_STORE, type PlacesStore } from '../application/ports.js';
import { PLACE_SEEDS } from '../domain/place-seeds.js';
import { POINTS_OF_INTEREST } from '../domain/points-of-interest.data.js';

/**
 * Nạp cây nơi và điểm OSM vào bảng mỗi lần worker khởi động (vài trăm dòng). Dữ liệu ít đổi và đi theo bản deploy,
 * nên không cần job định kỳ; db:seed không chạy ở production nên không đặt ở đó.
 * Chạy ở onModuleInit: xong trước khi job dựng chỉ mục tìm khám phá (onApplicationBootstrap) đọc điểm.
 */
@Injectable()
export class LoadPlacesJob implements OnModuleInit {
  private readonly logger = new Logger(LoadPlacesJob.name);

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(PLACES_STORE) private readonly store: PlacesStore,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.APP_ROLE === 'api') return;
    try {
      const count = await this.store.upsertSeed(PLACE_SEEDS, POINTS_OF_INTEREST, 'osm');
      this.logger.log(`Đã nạp ${count.places} nơi, ${count.points} điểm OSM`);
    } catch (error) {
      // Không chặn khởi động: /api/places và chỉ mục dùng dữ liệu đã có trong bảng.
      this.logger.error(`Nạp nơi và điểm OSM lỗi: ${(error as Error).message}`);
    }
  }
}
