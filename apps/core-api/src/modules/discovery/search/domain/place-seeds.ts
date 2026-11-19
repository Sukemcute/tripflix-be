import { PLACES, searchAliasesOf } from './places.js';
import { POI_CITIES } from './points-of-interest.data.js';
import type { PoiPlace } from './points-of-interest.js';

/** Cây nơi nạp vào discovery.places: PLACES kèm toạ độ tâm của các thành phố có dữ liệu OSM. */
export const PLACE_SEEDS: readonly (PoiPlace & { kind: 'province' | 'destination' })[] = PLACES.map((p) => {
  const centre = POI_CITIES.find((c) => c.id === p.id);
  return { id: p.id, name: p.name, kind: p.kind, parentId: p.parentId, aliases: searchAliasesOf(p), lat: centre?.lat ?? null, lng: centre?.lng ?? null };
});
