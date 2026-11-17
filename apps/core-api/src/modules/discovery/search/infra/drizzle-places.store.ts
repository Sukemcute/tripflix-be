import type { Db } from '@tripflix/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { places, pointsOfInterest } from '../../db/schema/index.js';
import type { PlacesStore } from '../application/ports.js';
import type { PoiKind, PointOfInterestSeed, PoiPlace } from '../domain/points-of-interest.js';

export class DrizzlePlacesStore implements PlacesStore {
  constructor(private readonly db: Db) {}

  async listPlaces(): Promise<PoiPlace[]> {
    return this.db
      .select({ id: places.id, name: places.name, parentId: places.parentId, aliases: places.aliases, lat: places.lat, lng: places.lng })
      .from(places);
  }

  // ponytail: đọc hết (vài trăm điểm) rồi lọc trong RAM; lọc trong SQL theo place_id, khung toạ độ khi lên hàng chục nghìn điểm.
  async listPoints(): Promise<PointOfInterestSeed[]> {
    const rows = await this.db.select().from(pointsOfInterest).where(eq(pointsOfInterest.isHidden, false));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as PoiKind,
      lat: r.lat,
      lng: r.lng,
      cityId: r.placeId,
      tags: r.tags,
      popularity: r.popularity,
    }));
  }

  async upsertSeed(
    placeSeeds: ReadonlyArray<PoiPlace & { kind: 'province' | 'destination' }>,
    points: readonly PointOfInterestSeed[],
    source: string,
  ): Promise<{ places: number; points: number }> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      // Nơi cha nằm trong cùng câu lệnh: khoá ngoại tự tham chiếu được kiểm ở cuối câu lệnh.
      await tx
        .insert(places)
        .values(placeSeeds.map((p) => ({ ...p, aliases: [...p.aliases], updatedAt: now })))
        .onConflictDoUpdate({
          target: places.id,
          set: {
            name: sql`excluded.name`,
            kind: sql`excluded.kind`,
            parentId: sql`excluded.parent_id`,
            aliases: sql`excluded.aliases`,
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            updatedAt: now,
          },
        });
      if (points.length) {
        await tx
          .insert(pointsOfInterest)
          .values(points.map(({ cityId, ...p }) => ({ ...p, placeId: cityId, source, updatedAt: now })))
          .onConflictDoUpdate({
            target: pointsOfInterest.id,
            // Không đụng is_hidden: điểm admin đã ẩn vẫn ẩn sau khi nạp lại.
            set: {
              placeId: sql`excluded.place_id`,
              kind: sql`excluded.kind`,
              name: sql`excluded.name`,
              lat: sql`excluded.lat`,
              lng: sql`excluded.lng`,
              tags: sql`excluded.tags`,
              popularity: sql`excluded.popularity`,
              source: sql`excluded.source`,
              updatedAt: now,
            },
          });
      }
      const keep = points.map((p) => p.id);
      await tx
        .delete(pointsOfInterest)
        .where(and(eq(pointsOfInterest.source, source), keep.length ? notInArray(pointsOfInterest.id, keep) : undefined));
    });
    return { places: placeSeeds.length, points: points.length };
  }
}
