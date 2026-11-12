// Dữ liệu đánh giá GIẢ LẬP cho demo, không phải đánh giá thật; tất định theo id khách sạn.

export interface GeneratedReview {
  id: string;
  propertyId: string;
  roomTypeId: string | null;
  authorName: string;
  rating: number;
  title: string | null;
  body: string;
  tags: string[];
  travelerType: string | null;
  stayMonth: string | null;
  createdAt: string;
  images: string[];
  helpfulCount: number;
}

export interface ReviewPhoto { category: string; file: string }

export interface CatalogHotelForReviews {
  id: string;
  name: string;
  style: string | null;
  stars: number | null;
  ratingAvg?: number | string | null;
  ratingSource?: string | null;
  roomTypes?: { id: string; name: string }[];
  details?: {
    amenities?: { name: string }[];
    nearby?: { name: string }[];
    highlights?: { text: string }[];
  } | null;
}

type Rng = () => number;
type HotelProfile = ReturnType<typeof profile>;
type ComplaintKey = 'wifi' | 'noise' | 'service' | 'parking' | 'room' | 'breakfast';
type TravelerType = 'family' | 'couple' | 'solo' | 'business' | 'friends';
type PhotoGroups = Record<string, string[]>;

// Mỗi khách sạn có một luồng ngẫu nhiên riêng, ổn định qua mọi lần chạy.
function hashId(value: string): number {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): Rng {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;
const chance = (p: number, rng: Rng): boolean => rng() < p;
const integer = (min: number, max: number, rng: Rng): number => min + Math.floor(rng() * (max - min + 1));
const chooseDistinct = <T>(items: readonly T[], count: number, rng: Rng): T[] => {
  const pool = [...items], out: T[] = [];
  while (pool.length && out.length < count) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  return out;
};

const TAGS = [
  'Gần biển', 'View đẹp', 'Phù hợp gia đình', 'Sạch sẽ', 'Nhân viên thân thiện',
  'Bữa sáng ngon', 'Vị trí trung tâm', 'Yên tĩnh', 'Hồ bơi đẹp', 'Đáng tiền',
  'Phòng rộng', 'Không khí trong lành', 'Lãng mạn',
];
const SURNAME = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Mai'];
const MIDDLE = ['Minh', 'Thu', 'Thanh', 'Gia', 'Ngọc', 'Quang', 'Hải', 'Phương', 'Thảo', 'Anh', 'Bảo', 'Khánh', 'Đức', 'Hồng', 'Nhật', 'Tuấn'];
const GIVEN = ['Anh', 'Hà', 'Nam', 'Long', 'Linh', 'Vy', 'Huy', 'Trang', 'Nhi', 'Khang', 'My', 'Hiếu', 'An', 'Duy', 'Thư', 'Hương', 'Sơn', 'Tâm', 'Phúc', 'Yến', 'Bình', 'Tú', 'Trâm', 'Lâm'];
const FOREIGN = ['David K.', 'Sakura T.', 'Kim Min-ji', 'Anna P.', 'Alex M.', 'Emma L.', 'Jisoo Park', 'Daniel R.', 'Sophie N.', 'Yuki S.', 'Michael T.', 'Hana Kim'];
function author(rng: Rng): string {
  if (chance(0.15, rng)) return pick(FOREIGN, rng);
  const s = pick(SURNAME, rng), m = pick(MIDDLE, rng), g = pick(GIVEN, rng);
  return chance(0.24, rng) ? `${m} ${g}` : chance(0.13, rng) ? `${s} ${m[0]}. ${g}` : `${s} ${m} ${g}`;
}

function profile(h: CatalogHotelForReviews) {
  const amenities = (h.details?.amenities || []).map(a => a.name).filter(Boolean);
  const has = (re: RegExp) => amenities.some(a => re.test(a));
  const beach = h.style === 'biển' || (h.style === 'resort' && (has(/bãi biển|thể thao dưới nước/i) || (h.details?.highlights || []).some(x => /biển/i.test(x.text)))) || has(/bãi biển riêng/i);
  const pool = has(/bể bơi/i);
  const breakfast = has(/nhà hàng buffet/i);
  const central = h.style === 'thành phố' || h.style === 'boutique';
  const mountain = h.style === 'núi';
  const candidates = [
    ...(beach ? ['Gần biển', 'View đẹp'] : []),
    ...(mountain ? ['Không khí trong lành', 'Yên tĩnh', 'View đẹp'] : []),
    ...(central ? ['Vị trí trung tâm'] : []),
    ...(pool ? ['Hồ bơi đẹp'] : []),
    ...(breakfast ? ['Bữa sáng ngon'] : []),
    'Sạch sẽ', 'Nhân viên thân thiện', 'Đáng tiền',
    ...(h.style === 'resort' ? ['Phù hợp gia đình', 'Lãng mạn'] : []),
    ...(h.style === 'homestay' ? ['Yên tĩnh'] : []),
  ];
  return { amenities, beach, pool, breakfast, central, mountain, candidates: [...new Set(candidates)] };
}

const COMPLAINTS: Record<ComplaintKey, string[]> = {
  wifi: ['Wifi hơi chập chờn vào buổi tối.', 'Mạng trong phòng chưa ổn định, gọi video hơi khó.', 'Wifi có lúc yếu nên mình phải dùng 4G.'],
  noise: ['Cách âm chưa tốt, buổi tối vẫn nghe tiếng ngoài hành lang.', 'Phòng hơi ồn khi có người đi qua.', 'Tiếng từ phòng bên cạnh nghe khá rõ.'],
  service: ['Lúc nhận phòng phải chờ hơi lâu.', 'Nhân viên xử lý yêu cầu hơi chậm.', 'Khâu nhận phòng chưa được nhanh như mình mong.'],
  parking: ['Bãi đỗ xe hơi chật vào giờ đông.', 'Chỗ đỗ xe không rộng lắm.', 'Tìm chỗ đỗ xe lúc cao điểm mất thêm thời gian.'],
  room: ['Một vài góc phòng đã cũ, cần chăm chút thêm.', 'Nội thất phòng có dấu hiệu xuống cấp.', 'Phòng chưa được bảo trì kỹ ở vài chi tiết nhỏ.'],
  breakfast: ['Bữa sáng chưa nhiều lựa chọn.', 'Món ăn sáng bổ sung hơi chậm.', 'Thực đơn bữa sáng hơi ít món.'],
};
const COMPLAINT_LABEL: Record<ComplaintKey, string> = {
  wifi: 'wifi chưa ổn định', noise: 'cách âm chưa tốt', service: 'thời gian chờ nhận phòng',
  parking: 'chỗ đỗ xe chật', room: 'một số chi tiết phòng đã cũ', breakfast: 'bữa sáng ít lựa chọn',
};
const TITLE: Record<number, string[]> = {
  5: ['Kỳ nghỉ rất đáng nhớ', 'Ở thoải mái ngoài mong đợi', 'Muốn quay lại lần nữa', 'Trải nghiệm thật dễ chịu'],
  4: ['Hài lòng với chuyến đi', 'Một nơi ở khá ổn', 'Dễ chịu và thuận tiện', 'Đáng cân nhắc cho kỳ nghỉ'],
  3: ['Ổn nhưng còn điểm trừ', 'Trải nghiệm ở mức vừa phải', 'Có điểm thích và chưa thích', 'Tạm ổn so với giá'],
  2: ['Chưa được như mong đợi', 'Cần cải thiện thêm vài điểm', 'Trải nghiệm chưa thật thoải mái'],
  1: ['Khá thất vọng lần này', 'Chưa đáp ứng kỳ vọng', 'Trải nghiệm cần cải thiện nhiều'],
};
const INTRO: Record<TravelerType, string[]> = {
  family: ['Nhà mình đi cùng con nhỏ', 'Gia đình mình ở đây vài hôm', 'Cả nhà chọn chỗ này cho chuyến đi'],
  couple: ['Hai đứa ở đây trong chuyến nghỉ ngắn', 'Mình đi cùng người yêu', 'Vợ chồng mình chọn nơi này'],
  solo: ['Mình đi một mình lần này', 'Chuyến này mình đi solo', 'Mình chọn ở đây khi đi một mình'],
  business: ['Mình ở đây trong chuyến công tác', 'Đi công tác nên mình chọn chỗ này', 'Mình có chuyến làm việc ở khu vực này'],
  friends: ['Nhóm bạn mình ở đây mấy hôm', 'Mình đi cùng vài người bạn', 'Cả nhóm chọn ở đây cho chuyến đi'],
};

function ratingList(n: number, avg: number, rng: Rng): number[] {
  const ratings: number[] = Array.from({ length: n }, () => {
    const x = rng();
    return x < 0.015 ? 1 : x < 0.045 ? 2 : x < 0.13 ? 3 : x < 0.48 ? 4 : 5;
  });
  let delta = Math.round(avg * n) - ratings.reduce((a, b) => a + b, 0);
  while (delta !== 0) {
    const eligible = ratings.map((r, i) => ({ r, i })).filter(x => delta > 0 ? x.r < 5 : x.r > 1);
    const index = pick(eligible, rng).i;
    ratings[index] = ratings[index]! + Math.sign(delta);
    delta -= Math.sign(delta);
  }
  return ratings;
}

function goodPoint(h: CatalogHotelForReviews, p: HotelProfile, rng: Rng): string {
  const options = [
    ...p.amenities.filter(a => !/bình chữa cháy|thiết bị báo cháy|thang máy|lễ tân|wifi|bãi đỗ|khuyết tật|ngoại tệ|giặt|ghế ăn|nôi|trạm sạc/i.test(a)).map(a => [
      `${a} dùng khá tiện, đúng như thông tin đăng.`,
      `Mình thích nhất là ${a}; trải nghiệm ở đây dễ chịu hơn hẳn.`,
      `${a} là điểm cộng rõ ràng trong lần ở này.`,
    ]),
    ...(h.details?.nearby || []).filter(x => x.name).map(x => [
      `Từ đây ghé ${x.name} cũng thuận đường.`,
      `Lịch trình của mình có ${x.name}, đi từ khách sạn khá tiện.`,
    ]),
  ];
  if (p.beach) options.push(['Không khí gần biển làm kỳ nghỉ thư thái hơn.', 'Buổi chiều ra khu vực biển khá thích.', 'Mình thích cảm giác nghỉ dưỡng gần biển ở đây.']);
  if (p.mountain) options.push(['Không khí vùng núi dễ chịu, sáng dậy thấy rất thư thái.', 'Buổi sáng ở vùng núi khá mát và yên tĩnh.']);
  if (p.central) options.push(['Vị trí trong thành phố tiện cho việc đi lại và ăn uống.', 'Ở khu này tìm chỗ ăn uống khá dễ.']);
  if (!options.length) options.push(['Vị trí khá thuận tiện cho lịch trình của mình.']);
  return pick(pick(options, rng), rng);
}

function complaintKey(p: HotelProfile, rng: Rng): ComplaintKey {
  const keys: ComplaintKey[] = ['wifi', 'noise', 'service', 'room', 'parking', ...(p.breakfast ? ['breakfast' as const] : [])];
  return pick(keys, rng);
}
function bodyFor(h: CatalogHotelForReviews, p: HotelProfile, rating: number, travelerType: TravelerType, room: { id: string; name: string } | null, rng: Rng) {
  const intro = `${pick(INTRO[travelerType], rng)}${room ? `, ở phòng ${room.name.replace(/^Phòng /i, '')}` : ''}${chance(0.3, rng) ? ` tại ${h.name}` : ''}.`;
  const notes: string[] = [];
  if (rating >= 4) {
    notes.push(pick(['Phòng sạch sẽ, nghỉ ngơi khá thoải mái.', 'Cảm giác chung là dễ chịu và xứng với số tiền bỏ ra.', 'Mọi thứ nhìn chung gọn gàng, phục vụ cũng thân thiện.'], rng));
    notes.push(goodPoint(h, p, rng));
    if (chance(rating === 4 ? 0.42 : 0.22, rng)) {
      const key = complaintKey(p, rng);
      notes.push(`Chỉ có điều ${pick(COMPLAINTS[key], rng).replace(/^[A-ZĐ]/u, c => c.toLocaleLowerCase('vi'))}`);
      return { body: [intro, ...notes].join(' '), complaint: key };
    }
    if (chance(0.5, rng)) notes.push(pick(['Mình sẽ cân nhắc quay lại.', 'Cả chuyến đi khá trọn vẹn.', 'Lần tới có dịp mình vẫn muốn ở đây.'], rng));
    return { body: [intro, ...notes].join(' '), complaint: null };
  }
  const key = complaintKey(p, rng);
  if (rating === 3) {
    notes.push(goodPoint(h, p, rng));
    notes.push(pick(COMPLAINTS[key], rng));
    if (chance(0.45, rng)) notes.push('Nếu cải thiện điểm này thì trải nghiệm sẽ ổn hơn nhiều.');
  } else {
    notes.push(pick(COMPLAINTS[key], rng));
    const key2 = complaintKey(p, rng);
    notes.push(pick(COMPLAINTS[key2], rng));
    if (chance(0.55, rng)) notes.push('Mong khách sạn sớm cải thiện để khách sau thoải mái hơn.');
  }
  return { body: [intro, ...notes].join(' '), complaint: key };
}

function tagsFor(p: HotelProfile, featured: string[], rating: number, travelerType: TravelerType, rng: Rng): string[] {
  if (rating <= 2) return [];
  const pool = [...featured, ...featured, ...featured, ...p.candidates];
  if (travelerType === 'family') pool.push('Phù hợp gia đình');
  if (travelerType === 'couple') pool.push('Lãng mạn');
  const allowed = new Set([...p.candidates, 'Phù hợp gia đình', 'Lãng mạn']);
  const out: string[] = [];
  const target = rating === 3 ? integer(1, 2, rng) : integer(1, 3, rng);
  let tries = 0;
  while (out.length < target && tries++ < 30) {
    const t = pick(pool, rng);
    if (allowed.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

function dates(rng: Rng) {
  const monthIndex = integer(0, 21, rng); // 2025-01 đến 2026-10
  const year = 2025 + Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  const stayMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const start = Date.UTC(year, month - 1, 1);
  const limit = Math.min(40, Math.floor((Date.UTC(2026, 10, 4) - start) / 86400000));
  const day = integer(3, limit, rng);
  const d = new Date(start + day * 86400000);
  d.setUTCHours(integer(7, 22, rng), integer(0, 59, rng), 0, 0);
  return { stayMonth, createdAt: d.toISOString() };
}

function summaryFor(p: HotelProfile, reviews: GeneratedReview[], complaints: Map<ComplaintKey, number>): string {
  const counts = new Map(TAGS.map(t => [t, 0]));
  for (const r of reviews) for (const t of r.tags) counts.set(t, counts.get(t)! + 1);
  const top = [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || TAGS.indexOf(a[0]) - TAGS.indexOf(b[0])).slice(0, 2).map(([t]) => t.toLocaleLowerCase('vi'));
  const praise = top.length ? `Khách thường nhắc đến ${top.join(' và ')}.` : 'Ý kiến của khách về trải nghiệm lưu trú khá đa dạng.';
  const issues = [...complaints].sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 0).slice(0, 2).map(([key]) => COMPLAINT_LABEL[key]);
  return issues.length ? `${praise} Một số khách góp ý về ${issues.join(' và ')}.` : praise;
}

// Khách sạn có điểm từ nguồn ngoài (ratingSource) nhiều đánh giá hơn; khách sạn lấy từ OSM ít hơn, sát thực tế khách sạn nhỏ.
export function reviewRange(h: CatalogHotelForReviews): [number, number] {
  if (h.ratingSource == null) return h.style === 'homestay' ? [30, 80] : h.stars === 5 ? [120, 220] : h.stars === 4 ? [80, 180] : [50, 140];
  return h.style === 'homestay' ? [100, 180] : h.stars === 5 ? [250, 400] : h.stars === 4 ? [180, 320] : h.stars === 3 ? [130, 250] : [100, 180];
}

function generateHotel(h: CatalogHotelForReviews, photos: PhotoGroups) {
  // Nội dung không trùng trong cùng một khách sạn.
  const globalBodies = new Set<string>();
  const rng = mulberry32(hashId(String(h.id)));
  const p = profile(h);
  const [nMin, nMax] = reviewRange(h);
  const n = integer(nMin, nMax, rng);
  const avg = h.ratingAvg == null ? 4.2 : Number(h.ratingAvg);
  const ratings = ratingList(n, avg, rng);
  const featured = chooseDistinct(p.candidates, Math.min(3, p.candidates.length), rng);
  const complaints = new Map<ComplaintKey, number>((Object.keys(COMPLAINTS) as ComplaintKey[]).map(k => [k, 0]));
  const reviews: GeneratedReview[] = [];
  const usedPhotos = new Set<string>();
  for (let i = 0; i < n; i++) {
    const room = h.roomTypes?.length && chance(0.85, rng) ? pick(h.roomTypes, rng) : null;
    const travelerType = pick<TravelerType>(['family', 'couple', 'solo', 'business', 'friends'], rng);
    let generated: ReturnType<typeof bodyFor> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      generated = bodyFor(h, p, ratings[i]!, travelerType, room, rng);
      if (!globalBodies.has(generated.body)) break;
    }
    if (!generated || globalBodies.has(generated.body)) throw new Error(`${h.id}: không tạo được body duy nhất`);
    globalBodies.add(generated.body);
    if (generated.complaint) complaints.set(generated.complaint, complaints.get(generated.complaint)! + 1);
    const photoPool = reviewPhotoPool(h, p, travelerType, photos);
    // Một ảnh không xuất hiện hai lần trong cùng khách sạn.
    const freePhotos = photoPool.filter((photo) => !usedPhotos.has(photo));
    const images = freePhotos.length && chance(0.30, rng) ? chooseDistinct(freePhotos, integer(1, Math.min(3, freePhotos.length), rng), rng) : [];
    for (const image of images) usedPhotos.add(image);
    reviews.push({
      id: `RV-${h.id}-${String(i + 1).padStart(3, '0')}`,
      propertyId: h.id,
      roomTypeId: room?.id ?? null,
      authorName: author(rng),
      rating: ratings[i]!,
      title: pick(TITLE[ratings[i]!]!, rng),
      body: generated.body,
      tags: tagsFor(p, featured, ratings[i]!, travelerType, rng),
      travelerType,
      ...dates(rng),
      images,
      helpfulCount: Math.min(60, Math.floor(-Math.log(1 - rng()) * 8)),
    });
  }
  reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  return { reviews, summary: summaryFor(p, reviews, complaints), n };
}

function validate(hotels: CatalogHotelForReviews[], reviews: GeneratedReview[], photos: PhotoGroups): number {
  const ids = new Set<string>(), bodies = new Set<string>(), tags = new Set(TAGS);
  let offset = 0, maxDeviation = 0;
  for (const h of hotels) {
    const group: GeneratedReview[] = [];
    bodies.clear();
    while (offset < reviews.length && reviews[offset]!.propertyId === h.id) group.push(reviews[offset++]!);
    const [min, max] = reviewRange(h);
    const hotelPhotos = new Set<string>();
    const fail = (why: string): never => { throw new Error(`${h.id}: ${why}`); };
    if (group.length < min || group.length > max) fail(`số review ${group.length} ngoài ${min}-${max}`);
    const deviation = Math.abs(group.reduce((sum, r) => sum + r.rating, 0) / group.length - (h.ratingAvg == null ? 4.2 : Number(h.ratingAvg)));
    if (deviation > 0.25 + 1e-9) fail(`độ lệch rating ${deviation}`);
    maxDeviation = Math.max(maxDeviation, deviation);
    const roomIds = new Set((h.roomTypes || []).map(r => r.id));
    const imagePaths = new Set(Object.values(photos).flat());
    for (const r of group) {
      if (ids.has(r.id)) fail(`id trùng ${r.id}`);
      if (bodies.has(r.body)) fail(`body trùng ${r.id}`);
      if (r.roomTypeId !== null && !roomIds.has(r.roomTypeId)) fail(`roomTypeId sai ${r.id}`);
      if (r.images.some(image => !imagePaths.has(image))) fail(`images sai ${r.id}`);
      if (r.tags.some(tag => !tags.has(tag))) fail(`tags sai ${r.id}`);
      if (r.images.some(image => hotelPhotos.has(image))) fail(`ảnh đánh giá lặp trong khách sạn ${r.id}`);
      r.images.forEach(image => hotelPhotos.add(image));
      if (r.rating <= 2 && r.tags.length) fail(`đánh giá thấp mà có tag khen ${r.id}`);
      if (r.stayMonth && r.stayMonth > r.createdAt.slice(0, 10)) fail(`ngày ở sau ngày viết ${r.id}`);
      if (r.createdAt > '2026-11-04T23:59:59.999Z') fail(`createdAt quá hạn ${r.id}`);
      ids.add(r.id); bodies.add(r.body);
    }
    if (group.some((r, i) => i && group[i - 1]!.createdAt < r.createdAt)) fail('thứ tự createdAt sai');
  }
  if (offset !== reviews.length) throw new Error(`${reviews[offset]!.propertyId}: review thừa hoặc sai thứ tự khách sạn`);
  return maxDeviation;
}

// Ảnh kiểu khách tự chụp (Unsplash/Pexels/Wikimedia), theo nhóm; chọn nhóm hợp với khách sạn và kiểu khách.
function reviewPhotoPool(h: CatalogHotelForReviews, p: HotelProfile, travelerType: TravelerType, photos: PhotoGroups): string[] {
  const cats = h.style === 'homestay' ? ['homestay', 'room', 'breakfast', 'local_food'] : ['room', 'bathroom', 'breakfast', 'lobby', 'local_food'];
  if (p.beach) cats.push('balcony_sea', 'beach', 'dinner');
  if (p.central) cats.push('view_city', 'dinner');
  if (p.mountain) cats.push('mountain');
  if (p.amenities.some((a) => /spa|mát-xa/i.test(a))) cats.push('spa');
  if (p.pool) cats.push('pool', ...(travelerType === 'family' ? ['kids'] : []));
  return [...new Set(cats)].flatMap(c => photos[c] || []);
}

export function generateReviews(hotels: CatalogHotelForReviews[], photoList: ReviewPhoto[]): { reviews: GeneratedReview[]; summaries: Record<string, string>; stats: Record<string, { count: number; avg: number }> } {
  const photos: PhotoGroups = {};
  for (const photo of photoList) (photos[photo.category] ??= []).push('/images/reviews/' + photo.file);
  const reviews: GeneratedReview[] = [], summaries: Record<string, string> = {}, stats: Record<string, { count: number; avg: number }> = {};
  for (const hotel of hotels) {
    const result = generateHotel(hotel, photos);
    reviews.push(...result.reviews);
    summaries[hotel.id] = result.summary;
    stats[hotel.id] = { count: result.reviews.length, avg: Math.round(result.reviews.reduce((sum, r) => sum + r.rating, 0) / result.reviews.length * 10) / 10 };
  }
  validate(hotels, reviews, photos);
  return { reviews, summaries, stats };
}

