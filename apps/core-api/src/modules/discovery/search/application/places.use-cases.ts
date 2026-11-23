import { Inject, Injectable } from '@nestjs/common';
import { findPointsOfInterest, type PoiPlace, type PoiQuery, type PoiResult, type PointOfInterestSeed } from '../domain/points-of-interest.js';
import { PLACES_STORE, type PlacesStore } from './ports.js';

/** Dữ liệu OSM nạp bằng job, admin ẩn điểm thì chậm tối đa chừng này mới thấy. */
export const PLACES_SNAPSHOT_TTL_MS = 60_000;

/** Địa điểm ngoài OTA có toạ độ cho Tripi xếp lộ trình (GET /api/places). */
@Injectable()
export class PlacesUseCases {
  private snapshot?: { at: number; data: Promise<[PoiPlace[], PointOfInterestSeed[]]> };

  constructor(@Inject(PLACES_STORE) private readonly store: Pick<PlacesStore, 'listPlaces' | 'listPoints'>) {}

  async find(query: PoiQuery): Promise<PoiResult[]> {
    const [places, points] = await this.load();
    return findPointsOfInterest(query, points, places);
  }

  /** Mỗi request trước đây đọc toàn bộ điểm rồi lọc trong bộ nhớ: giữ bản đọc 60 giây, request đồng thời dùng chung. */
  private load(): Promise<[PoiPlace[], PointOfInterestSeed[]]> {
    const now = Date.now();
    if (this.snapshot && now - this.snapshot.at < PLACES_SNAPSHOT_TTL_MS) return this.snapshot.data;
    const data = Promise.all([this.store.listPlaces(), this.store.listPoints()]);
    const snapshot = { at: now, data };
    this.snapshot = snapshot;
    // Lỗi thì không giữ: lần gọi sau đọc lại ngay.
    data.catch(() => {
      if (this.snapshot === snapshot) this.snapshot = undefined;
    });
    return data;
  }
}
