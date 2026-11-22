// Kiểm bộ câu với seed commerce: câu "top1" phải có ít nhất một khách sạn thoả mọi ràng buộc cứng,
// câu bẫy "empty" phải không có khách sạn nào thoả. Chạy lại khi seed commerce đổi:
//   node apps/core-api/src/modules/discovery/search/eval/check-queries.mjs
// Chỉ đọc file seed (dữ liệu thử), không import code của commerce. Giá theo seed-catalog.ts: basePrice × priceFactor của
// loại phòng, làm tròn 10.000đ, gói mặc định (RO, hệ số 1); lịch trống mở ra cùng một giá mỗi ngày.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const print = (line) => process.stdout.write(`${line}\n`);

const here = dirname(fileURLToPath(import.meta.url));
const { distribution, queries } = JSON.parse(readFileSync(join(here, 'queries.json'), 'utf8'));
const { hotels } = JSON.parse(readFileSync(join(here, '../../../commerce/db/seed/catalog.json'), 'utf8'));

const roundToTenThousand = (amount) => Math.max(10_000, Math.round(amount / 10_000) * 10_000);
const seedSlugs = new Set(hotels.map((h) => h.provinceSlug));

/** Giá rẻ nhất của khách sạn thoả số khách, số đêm, ngân sách; null nếu không có loại phòng nào thoả. */
function cheapestFit(hotel, e) {
  const guests = e.guests ?? 2;
  const nights = e.nights ?? 1;
  const totals = hotel.roomTypes.flatMap((rt) => {
    const rooms = e.singleRoom ? 1 : Math.ceil(guests / rt.maxGuests);
    if (rooms * rt.maxGuests < guests) return [];
    const nightly = roundToTenThousand(hotel.basePrice * rt.priceFactor);
    const total = nightly * nights * rooms;
    const b = e.budget;
    const isWithinBudget =
      !b || (b.per === 'night' && nightly <= b.max) || (b.per === 'group' && total <= b.max) || (b.per === 'person' && total / guests <= b.max);
    return isWithinBudget ? [total] : [];
  });
  return totals.length ? Math.min(...totals) : null;
}

function candidatesOf(e) {
  if (e.unknownPlace) return [];
  return hotels.filter(
    (h) =>
      e.places.includes(h.provinceSlug) &&
      (!e.styles || e.styles.includes(h.style)) &&
      (!e.minStars || (h.stars ?? 0) >= e.minStars) &&
      (!e.brand || h.brand === e.brand) &&
      cheapestFit(h, e) !== null,
  );
}

const problems = [];
const counts = {};
for (const q of queries) counts[q.group] = (counts[q.group] ?? 0) + 1;
if (queries.length !== 50) problems.push(`Có ${queries.length} câu, cần 50`);
if (new Set(queries.map((q) => q.id)).size !== queries.length) problems.push('Trùng id');
for (const [group, n] of Object.entries(distribution)) if (counts[group] !== n) problems.push(`Nhóm ${group}: ${counts[group] ?? 0} câu, khai báo ${n}`);

for (const q of queries) {
  const e = q.expect;
  for (const slug of e.places ?? []) if (!seedSlugs.has(slug)) problems.push(`${q.id}: nơi "${slug}" không có trong seed`);
  if (e.unknownPlace && seedSlugs.has(e.unknownPlace)) problems.push(`${q.id}: "${e.unknownPlace}" lại có trong seed`);
  if (q.surface !== 'stays' || q.judge === 'refuse' || !(e.places || e.unknownPlace)) {
    print(`${q.id}  ${q.judge.padEnd(6)} ${q.surface.padEnd(5)}  (chấm tay)  ${q.q}`);
    continue;
  }
  const found = candidatesOf(e);
  const isOk = q.judge === 'top1' ? found.length > 0 : found.length === 0;
  if (!isOk) problems.push(`${q.id} (${q.judge}): ${found.length} khách sạn thoả — "${q.q}"`);
  const sample = found.slice(0, 2).map((h) => `${h.name} ${cheapestFit(h, e)}`).join('; ');
  print(`${q.id}  ${q.judge.padEnd(6)} stays  ${String(found.length).padStart(3)} khớp  ${q.q}${sample ? `  → ${sample}` : ''}`);
}

if (problems.length) {
  process.stderr.write(`\n${problems.length} lỗi:\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
print('\nBộ câu khớp seed commerce.');
