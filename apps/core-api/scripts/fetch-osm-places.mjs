// Tải điểm tham quan, ăn uống, chỗ ở từ OpenStreetMap (Overpass) cho các thành phố demo của Tripi,
// rồi sinh src/modules/discovery/search/domain/points-of-interest.data.ts (TF31, plan B1).
// Dữ liệu © OpenStreetMap contributors, giấy phép ODbL: API trả kèm dòng ghi nguồn.
// Chạy: node apps/core-api/scripts/fetch-osm-places.mjs  (cần mạng; không cần database)
import { writeFileSync } from 'node:fs';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const RADIUS_M = 12000;
const LIMITS = { see: 40, food: 20, cafe: 15, lodging: 15 };
// Toạ độ trung tâm lấy theo OSM; id trùng id điểm đến của discovery (places.ts).
const CITIES = [
  { id: 'vung-tau', name: 'Vũng Tàu', lat: 10.346, lng: 107.0843 },
  { id: 'da-lat', name: 'Đà Lạt', lat: 11.9404, lng: 108.4583 },
  { id: 'da-nang', name: 'Đà Nẵng', lat: 16.0544, lng: 108.2022 },
  { id: 'nha-trang', name: 'Nha Trang', lat: 12.2388, lng: 109.1967 },
  { id: 'phu-quoc', name: 'Phú Quốc', lat: 10.2899, lng: 103.984 },
  { id: 'ha-noi', name: 'Hà Nội', lat: 21.0285, lng: 105.8542 },
  { id: 'ho-chi-minh', name: 'TP. Hồ Chí Minh', lat: 10.7769, lng: 106.7009 },
];

function kindAndTags(t) {
  if (t.tourism === 'hotel' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel') {
    return ['lodging', []];
  }
  if (t.amenity === 'restaurant' || t.amenity === 'fast_food') return ['food', []];
  if (t.amenity === 'cafe') return ['cafe', ['indoor']];
  if (t.natural === 'beach') return ['see', ['beach']];
  if (t.tourism === 'viewpoint') return ['see', ['viewpoint']];
  if (t.tourism === 'museum') return ['see', ['museum', 'indoor']];
  if (t.leisure === 'park') return ['see', ['park']];
  if (t.amenity === 'marketplace') return ['see', ['market']];
  if (t.amenity === 'place_of_worship') return ['see', ['temple']];
  if (t.tourism === 'attraction' || t.historic) return ['see', ['viewpoint']];
  return [null, []];
}

// OSM không có độ phổ biến: dùng dấu hiệu có bài Wikipedia, Wikidata, website [HIỆU CHỈNH].
function popularity(t) {
  const score = 0.4 + (t.wikidata ? 0.3 : 0) + (t.wikipedia ? 0.2 : 0) + (t.website ? 0.1 : 0);
  return Math.round(score * 100) / 100;
}

function query(city) {
  const around = `(around:${RADIUS_M},${city.lat},${city.lng})`;
  const filters = [
    'node["natural"="beach"]["name"]', 'way["natural"="beach"]["name"]',
    'node["tourism"~"^(viewpoint|museum|attraction)$"]["name"]', 'way["tourism"~"^(museum|attraction)$"]["name"]',
    'way["leisure"="park"]["name"]', 'node["amenity"~"^(marketplace|place_of_worship)$"]["name"]',
    'way["amenity"~"^(marketplace|place_of_worship)$"]["name"]', 'node["historic"]["name"]',
    'node["amenity"~"^(restaurant|cafe)$"]["name"]',
    'node["tourism"~"^(hotel|guest_house|hostel|motel)$"]["name"]',
  ];
  return `[out:json][timeout:60];(${filters.map((f) => `${f}${around};`).join('')});out center tags;`;
}

// Overpass công cộng hay quá tải (502, 504, 429): thử lại có giãn cách, đổi sang máy chủ dự phòng.
const MIRRORS = [OVERPASS, 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(city) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(MIRRORS[attempt % MIRRORS.length], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'tripflix-seed/1.0' },
      body: `data=${encodeURIComponent(query(city))}`,
    });
    // Quá giờ thì Overpass vẫn trả 200 kèm `remark` và danh sách rỗng: coi như lỗi.
    const body = response.ok ? await response.json() : null;
    if (body?.elements?.length) return body;
    console.log(`  ${city.name}: Overpass ${response.status} ${body?.remark ?? ''}, thử lại`);
    await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
  }
  throw new Error(`Overpass không trả lời cho ${city.name}`);
}

async function fetchCity(city) {
  const { elements } = await overpass(city);
  const byKind = { see: [], food: [], cafe: [], lodging: [] };
  const seen = new Set();
  for (const e of elements) {
    const t = e.tags ?? {};
    const name = t['name:vi'] ?? t.name;
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const [kind, tags] = kindAndTags(t);
    // "An Lạc Tâm", "An lac tam", "An Lac Tam 3" là một chuỗi: so tên bỏ dấu, hoa thường, số.
    const key = `${kind}:${dedupeKey(name)}`;
    if (!kind || !name || lat == null || lng == null || seen.has(key)) continue;
    seen.add(key);
    byKind[kind].push({
      id: `osm:${e.type}/${e.id}`,
      name: String(name).slice(0, 120),
      kind,
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      cityId: city.id,
      tags,
      popularity: popularity(t),
    });
  }
  // Quán gần như không có Wikipedia nên cùng điểm: xếp theo tên thì chỉ lấy quán tên "1998", "Ah Mei"...
  // Gần trung tâm hơn thì gần chỗ khách du lịch hay đi hơn.
  const offCentre = (p) => Math.hypot(p.lat - city.lat, (p.lng - city.lng) * Math.cos((city.lat * Math.PI) / 180));
  return Object.entries(byKind).flatMap(([kind, list]) =>
    list.sort((a, b) => b.popularity - a.popularity || offCentre(a) - offCentre(b)).slice(0, LIMITS[kind]),
  );
}

function dedupeKey(name) {
  return String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim() || String(name);
}

const all = [];
for (const city of CITIES) {
  const points = await fetchCity(city);
  console.log(`${city.name}: ${points.length}`);
  all.push(...points);
  await new Promise((resolve) => setTimeout(resolve, 2000)); // lịch sự với Overpass công cộng
}
const out = new URL('../src/modules/discovery/search/domain/points-of-interest.data.ts', import.meta.url);
const header = [
  '// File sinh tự động bởi apps/core-api/scripts/fetch-osm-places.mjs, không sửa tay.',
  `// Nguồn: © OpenStreetMap contributors (ODbL), tải ngày ${new Date().toISOString().slice(0, 10)}.`,
  "import type { PointOfInterestSeed } from './points-of-interest.js';",
  '',
  `export const POI_CITIES = ${JSON.stringify(CITIES, null, 2)} as const;`,
  '',
  'export const POINTS_OF_INTEREST: readonly PointOfInterestSeed[] = [',
];
writeFileSync(out, `${header.join('\n')}\n${all.map((p) => `  ${JSON.stringify(p)},`).join('\n')}\n];\n`);
console.log(`total ${all.length} -> ${out.pathname}`);
