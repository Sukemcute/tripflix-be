import { Inject, Injectable } from '@nestjs/common';
import { findPointsOfInterest, type PoiQuery, type PoiResult } from '../domain/points-of-interest.js';
import { PLACES_STORE, type PlacesStore } from './ports.js';

/** Địa điểm ngoài OTA có toạ độ cho Tripi xếp lộ trình (GET /api/places). */
@Injectable()
export class PlacesUseCases {
  constructor(@Inject(PLACES_STORE) private readonly store: Pick<PlacesStore, 'listPlaces' | 'listPoints'>) {}

  async find(query: PoiQuery): Promise<PoiResult[]> {
    const [places, points] = await Promise.all([this.store.listPlaces(), this.store.listPoints()]);
    return findPointsOfInterest(query, points, places);
  }
}
