import { fileURLToPath } from 'node:url';
import { createDb, createPool } from '@tripflix/db';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import type pg from 'pg';
import { PLACE_SEEDS } from '../domain/place-seeds.js';
import type { PointOfInterestSeed } from '../domain/points-of-interest.js';
import { DrizzlePlacesStore } from './drizzle-places.store.js';

const point = (id: string, name: string): PointOfInterestSeed => ({
  id, name, kind: 'cafe', lat: 11.94, lng: 108.45, cityId: 'da-lat', tags: ['indoor'], popularity: 0.5,
});

/** Nạp lại nhiều lần: sửa điểm còn trong nguồn, xoá điểm đã mất khỏi nguồn, giữ cờ ẩn của admin. */
describe('DrizzlePlacesStore trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let store: DrizzlePlacesStore;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('discovery');
    await migrateModule({ url, module: 'discovery', migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    pool = createPool({ url, max: 2, applicationName: 'discovery-places-int-test' });
    store = new DrizzlePlacesStore(createDb(pool));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it('nạp cây nơi kèm nơi cha trong cùng câu lệnh, rồi nạp lại không trùng', async () => {
    await store.upsertSeed(PLACE_SEEDS, [], 'osm');
    await store.upsertSeed(PLACE_SEEDS, [], 'osm');
    const places = await store.listPlaces();
    expect(places).toHaveLength(PLACE_SEEDS.length);
    expect(places.find((p) => p.id === 'da-lat')).toMatchObject({ parentId: 'lam-dong', lat: 11.9404 });
  });

  it('nạp lại giữ điểm admin đã ẩn, sửa tên điểm còn trong nguồn, xoá điểm đã mất', async () => {
    await store.upsertSeed(PLACE_SEEDS, [point('osm:node/1', 'Cũ'), point('osm:node/2', 'Bị ẩn'), point('osm:node/3', 'Sẽ mất')], 'osm');
    await pool.query(`update discovery.points_of_interest set is_hidden = true where id = 'osm:node/2'`);
    await store.upsertSeed(PLACE_SEEDS, [point('osm:node/1', 'Mới'), point('osm:node/2', 'Bị ẩn')], 'osm');
    const points = await store.listPoints();
    expect(points).toEqual([expect.objectContaining({ id: 'osm:node/1', name: 'Mới', cityId: 'da-lat', tags: ['indoor'] })]);
    const { rows } = await pool.query(`select id, is_hidden from discovery.points_of_interest order by id`);
    expect(rows).toEqual([
      { id: 'osm:node/1', is_hidden: false },
      { id: 'osm:node/2', is_hidden: true },
    ]);
  });
});
