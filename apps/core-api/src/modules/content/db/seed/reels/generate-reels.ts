import type { MediaQualityLevel } from '@tripflix/contracts';
import type { TripAttachmentData, TripItineraryItem } from '../../schema/index.js';
import type { ContentSeed } from '../seed-content.js';
import { REEL_DESTINATIONS, type ReelDestination } from './reel-destinations.js';

/** Một trong 60 video mẫu đã chuyển HLS trên S3, kèm thông tin Duy dựng video. */
export interface ReelVideo {
  id: string;
  destinationKey: string | null;
  title: string;
  location: string;
  category: string;
  script: string[];
  tip: string;
  budget: string;
  media: {
    mimeType: string;
    fileSizeBytes: number;
    sourceKey: string;
    hlsPrefix: string;
    durationSec: number;
    aspect: '9:16' | '16:9' | '1:1';
    levels: MediaQualityLevel[];
  };
}

export interface ReelStop {
  name: string;
  area: string;
  note: string;
}

export type ReelStops = Record<string, { food: ReelStop[]; cafe: ReelStop[]; fun: ReelStop[] }>;

/** Phần catalog commerce bộ sinh cần; CLI seed đọc từ catalog.json rồi truyền vào. */
export interface ReelCatalogHotel {
  id: string;
  name: string;
  provinceSlug: string;
  city: string;
  address: string;
  basePrice: number;
  roomTypes: { id: string; name: string; ratePlans: { code: string; name: string }[] }[];
}

export interface ReelCatalogFlight {
  fromAirport: string;
  toAirport: string;
  departTime: string;
  basePrice: number;
}

export interface GenerateReelsInput {
  videos: ReelVideo[];
  stops: ReelStops;
  hotels: ReelCatalogHotel[];
  flights: ReelCatalogFlight[];
  /** Tài khoản đăng bài và tương tác (loadtestNNNN trên server). */
  authorIds: string[];
  /** Bài mới nhất đăng trước mốc này; cố định để chạy lại ra cùng dữ liệu. */
  now: Date;
  postCount?: number;
  tripCount?: number;
}

export const REEL_POST_COUNT = 1000;
export const REEL_TRIP_COUNT = 400;
export const REEL_SPREAD_DAYS = 120;
const RANDOM_SEED = 20261117;
const HUBS = ['SGN', 'HAN', 'DAD'];
const AIRPORT_CITY: Record<string, string> = {
  SGN: 'TP.HCM', HAN: 'Hà Nội', DAD: 'Đà Nẵng', DLI: 'Đà Lạt', PQC: 'Phú Quốc', VDO: 'Vân Đồn', HUI: 'Huế',
  CXR: 'Nha Trang', UIH: 'Quy Nhơn', TBB: 'Tuy Hòa', VCS: 'Côn Đảo', VCA: 'Cần Thơ', VCL: 'Chu Lai',
  HPH: 'Hải Phòng', BMV: 'Buôn Ma Thuột', CAH: 'Cà Mau',
};

/** Khoá cố định theo số thứ tự, cùng kiểu với posts-seed.json: chạy lại không tạo trùng. */
export function reelSeedId(group: 'media' | 'post' | 'comment' | 'reaction' | 'bookmark', index: number): string {
  const prefix = { media: '018da010', post: '018da020', comment: '018da040', reaction: '018da050', bookmark: '018da060' }[group];
  return `${prefix}-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const shuffle = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };
  const sample = <T>(list: readonly T[], count: number): T[] => shuffle(list).slice(0, count);
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return { next, int, pick, shuffle, sample, normal };
}
type Random = ReturnType<typeof createRandom>;

function normalize(text: string): string {
  return text.replace(/Đ/g, 'D').replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function toTag(text: string): string {
  return normalize(text).replace(/[^a-z0-9]/g, '');
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} triệu`;
  return `${Math.round(value / 1000)}k`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const total = Math.min(23 * 60 + 30, Math.max(5 * 60, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Chia đều 1000 bài cho 60 video, xếp theo vòng để hai bài cùng video luôn cách xa nhau trên feed. */
function buildVideoOrder(videos: ReelVideo[], postCount: number, random: Random): ReelVideo[] {
  const base = Math.floor(postCount / videos.length);
  const extra = new Set(random.sample(videos.map((v) => v.id), postCount - base * videos.length));
  const remaining = new Map(videos.map((v) => [v.id, base + (extra.has(v.id) ? 1 : 0)]));
  const order: ReelVideo[] = [];
  while (order.length < postCount) {
    // Trộn mỗi vòng nhưng tránh để video cuối vòng trước lặp lại ngay đầu vòng sau.
    const recent = new Set(order.slice(-15).map((v) => v.id));
    const left = videos.filter((v) => remaining.get(v.id)! > 0);
    const shuffled = random.shuffle(left);
    const fresh = shuffled.filter((v) => !recent.has(v.id));
    const round = [...fresh.slice(0, 15), ...random.shuffle([...fresh.slice(15), ...shuffled.filter((v) => recent.has(v.id))])];
    for (const video of round) {
      order.push(video);
      remaining.set(video.id, remaining.get(video.id)! - 1);
    }
  }
  return order;
}

const GROUPS = ['cặp đôi', 'gia đình có con nhỏ', 'hội bạn thân', 'người đi một mình', 'team công sở', 'bố mẹ lớn tuổi', 'nhóm sinh viên', 'đôi bạn gái', 'gia đình ba thế hệ', 'hội phượt thủ'];
const SEASONS = ['mùa mưa', 'mùa khô', 'dịp cuối tuần', 'kỳ nghỉ lễ', 'mùa thấp điểm', 'đầu năm', 'cuối năm', 'mùa hè', 'tháng 3', 'tháng 10'];
const TITLE_TEMPLATES = [
  (d: string, n: number, g: string, s: string) => `${d} ${n}N${n - 1}Đ cho ${g}: đi ${s} vẫn đáng tiền`,
  (d: string, n: number, g: string) => `Lịch trình ${d} ${n} ngày dành cho ${g}, có giá từng chặng`,
  (d: string, _n: number, g: string, s: string) => `${d} ${s}: review thật của ${g} sau chuyến đi`,
  (d: string, n: number, g: string) => `${n} ngày ở ${d} với ${g}, ghi lại hết chỗ ăn chỗ ngủ`,
  (d: string, _n: number, g: string, s: string) => `Đi ${d} ${s} cùng ${g} cần chuẩn bị gì?`,
  (d: string, n: number, _g: string, s: string) => `Ghi chú ${n} ngày ở ${d} ${s}, ai sắp đi lưu lại nha`,
  (d: string, n: number, g: string) => `${g[0]!.toUpperCase()}${g.slice(1)} đi ${d} ${n} ngày: tiêu hết bao nhiêu?`,
  (d: string, _n: number, g: string, s: string) => `Chuyến ${d} ${s} của ${g}: chỗ nào nên đi, chỗ nào bỏ qua`,
  (d: string, n: number, g: string, s: string) => `${d} ${s}: ${n} ngày thong thả cho ${g}`,
  (d: string, n: number, g: string) => `Tự túc ${d} ${n} ngày, kinh nghiệm thật cho ${g}`,
];
const OPENERS = [
  'Mới đi về nên viết nóng hổi cho mọi người.',
  'Chuyến này đi theo kiểu chậm rãi, không chạy deadline.',
  'Lưu lại cho ai đang lên kế hoạch giống mình.',
  'Lần thứ hai quay lại mà vẫn thấy mê.',
  'Đi xong mới thấy chọn đúng lịch là thắng một nửa.',
  'Không quảng cáo, chỉ là ghi chép thật của chuyến đi.',
  'Ai hỏi mình đi đâu dịp này thì đây nhé.',
  'Viết dài một chút vì nhiều bạn nhắn hỏi.',
  'Video quay vội nhưng trải nghiệm thì rất đáng.',
  'Tóm tắt nhanh những gì mình thấy đáng nhất.',
];
const CLOSERS = [
  'Ai cần thêm thông tin cứ hỏi dưới bình luận.',
  'Lưu lại để chuyến sau khỏi tìm nữa.',
  'Bạn nào đi rồi chia sẻ thêm quán ngon nhé.',
  'Đi một lần là muốn quay lại.',
  'Nhớ kiểm tra thời tiết trước khi đi.',
  'Có gì thay đổi mình sẽ cập nhật thêm.',
  'Hẹn gặp ở chuyến đi tiếp theo.',
  'Thả tim nếu thấy hữu ích nha.',
];
const COMMENTS = [
  'Lịch trình chi tiết quá, lưu lại liền!',
  'Đi {dest} mùa này có đông không bạn?',
  'Chi phí như vậy là hợp lý ghê.',
  '{stop} mình cũng ghé rồi, công nhận ngon.',
  'Cho mình xin tên chỗ ở với bạn ơi.',
  'Video đẹp quá, quay bằng máy gì vậy?',
  'Tháng sau mình đi {dest}, tham khảo bài này luôn.',
  'Đi theo gia đình có con nhỏ có ổn không bạn?',
  'Bạn đặt phòng trước bao lâu vậy?',
  'Nhìn mà muốn xách balo lên đi ngay.',
  'Thông tin hữu ích, cảm ơn bạn nhiều!',
  'Tag đứa bạn vào để rủ đi {dest} nè.',
  'Mình thấy nên đi sớm để tránh nắng.',
  'Có cần thuê xe máy không bạn?',
  'Giá vé bay đợt này rẻ không bạn?',
];
const REPLIES = [
  'Mình đặt trước khoảng 2 tuần nha.',
  'Cuối tuần hơi đông, ngày thường thì ổn bạn.',
  'Có nha, bạn cứ hỏi thêm mình trả lời.',
  'Đúng rồi, đi sớm là đẹp nhất.',
  'Mình thuê xe ngay gần chỗ ở, tiện lắm.',
  'Cảm ơn bạn đã ghé xem!',
];

interface HotelChoice {
  hotel: ReelCatalogHotel;
  roomType: ReelCatalogHotel['roomTypes'][number];
  ratePlan: { code: string; name: string };
}

function hotelsFor(destination: ReelDestination, hotels: ReelCatalogHotel[]): ReelCatalogHotel[] {
  const keywords = destination.keywords?.map(normalize);
  return hotels.filter(
    (h) =>
      destination.provinceSlugs.includes(h.provinceSlug) &&
      h.roomTypes.some((r) => r.ratePlans.length > 0) &&
      (!keywords || keywords.some((k) => normalize(`${h.name} ${h.city} ${h.address}`).includes(k))),
  );
}

function chooseHotel(hotel: ReelCatalogHotel, random: Random): HotelChoice {
  const roomType = random.pick(hotel.roomTypes.filter((r) => r.ratePlans.length > 0));
  return { hotel, roomType, ratePlan: random.pick(roomType.ratePlans) };
}

function hasRoute(flights: ReelCatalogFlight[], from: string, to: string): ReelCatalogFlight[] {
  return flights.filter((f) => f.fromAirport === from && f.toAirport === to);
}

/** Số điểm đặt được: 1 khách sạn ... 3 khách sạn + bay đi + bay về. */
function planBookables(random: Random, maxHotels: number, canFly: boolean): { hotels: number; flights: number } {
  const roll = random.next();
  const target = roll < 0.2 ? 1 : roll < 0.45 ? 2 : roll < 0.7 ? 3 : roll < 0.85 ? 4 : 5;
  const options: Record<number, { hotels: number; flights: number }[]> = {
    1: [{ hotels: 1, flights: 0 }],
    2: [{ hotels: 1, flights: 1 }, { hotels: 2, flights: 0 }],
    3: [{ hotels: 1, flights: 2 }, { hotels: 3, flights: 0 }],
    4: [{ hotels: 2, flights: 2 }],
    5: [{ hotels: 3, flights: 2 }],
  };
  const fits = options[target]!.filter((o) => o.hotels <= maxHotels && (canFly || o.flights === 0));
  if (fits.length > 0) return random.pick(fits);
  return { hotels: Math.min(maxHotels, Math.max(1, target)), flights: 0 };
}

function stopItem(day: number, time: string, stop: ReelStop, destination: ReelDestination, kind: 'food' | 'cafe' | 'fun'): TripItineraryItem {
  const verb = kind === 'food' ? 'Ăn ở' : kind === 'cafe' ? 'Cà phê ở' : 'Ghé';
  return { day, time, title: `${verb} ${stop.name}`, location: `${stop.area}, ${destination.name}`, notes: stop.note };
}

function buildTrip(
  destination: ReelDestination,
  input: GenerateReelsInput,
  random: Random,
): { trip: TripAttachmentData; hotelNames: string[]; stopNames: string[] } {
  const pool = hotelsFor(destination, input.hotels);
  const origins = random.shuffle(HUBS.filter((h) => h !== destination.airport));
  const origin = origins.find((o) => hasRoute(input.flights, o, destination.airport).length > 0 && hasRoute(input.flights, destination.airport, o).length > 0);
  const plan = planBookables(random, Math.min(3, pool.length), !!origin);
  const choices = random.sample(pool, plan.hotels).map((h) => chooseHotel(h, random));
  const nightsPerHotel = choices.map(() => random.int(1, 2));
  const daysCount = nightsPerHotel.reduce((a, b) => a + b, 0) + 1;
  const stops = input.stops[destination.key]!;
  const food = random.shuffle(stops.food);
  const cafe = random.shuffle(stops.cafe);
  const fun = random.shuffle(stops.fun);
  const items: TripItineraryItem[] = [];
  const stopNames: string[] = [];
  const takeStop = (day: number, time: string, kind: 'food' | 'cafe' | 'fun') => {
    const list = kind === 'food' ? food : kind === 'cafe' ? cafe : fun;
    const stop = list.shift();
    if (!stop) return;
    stopNames.push(stop.name);
    items.push(stopItem(day, time, stop, destination, kind));
  };

  // Chuyến đi bay sáng, chuyến về bay chiều nếu có, để lịch trong ngày hợp lý.
  const prefer = (list: ReelCatalogFlight[], ok: (f: ReelCatalogFlight) => boolean) => (list.some(ok) ? list.filter(ok) : list);
  const outbound = plan.flights >= 1 && origin
    ? random.pick(prefer(hasRoute(input.flights, origin, destination.airport), (f) => f.departTime >= '06:00' && f.departTime <= '10:30'))
    : undefined;
  const inbound = plan.flights >= 2 && origin
    ? random.pick(prefer(hasRoute(input.flights, destination.airport, origin), (f) => f.departTime >= '14:00' && f.departTime <= '20:00'))
    : undefined;
  const flightTitle = (f: ReelCatalogFlight) =>
    `Bay ${AIRPORT_CITY[f.fromAirport] ?? f.fromAirport} → ${AIRPORT_CITY[f.toAirport] ?? f.toAirport}`;
  const transfer = destination.transfer && (outbound || random.next() < 0.5) ? destination.transfer : undefined;

  // Ngày 1: bay tới, đi xe tới nơi, rồi mới nhận phòng; tới muộn thì bớt điểm chơi.
  let clock = '09:00';
  if (outbound) {
    items.push({
      day: 1,
      time: outbound.departTime,
      title: flightTitle(outbound),
      notes: random.pick(['Bay sớm cho kịp chơi buổi chiều', 'Đặt vé trước 2–3 tuần giá tốt hơn', 'Mang hành lý xách tay cho gọn', 'Chọn ghế cửa sổ để ngắm cảnh']),
      transport: { mode: 'flight', fromAirport: outbound.fromAirport, toAirport: outbound.toAirport },
    });
    clock = addMinutes(outbound.departTime, 120);
  }
  if (transfer) {
    if (!outbound) clock = '07:00';
    items.push({ day: 1, time: clock, title: `Di chuyển ${transfer.from} → ${destination.name}`, notes: transfer.note, transport: { mode: transfer.mode } });
    clock = addMinutes(clock, transfer.minutes);
  }
  const hotelItem = (day: number, time: string, choice: HotelChoice): TripItineraryItem => ({
    day,
    time,
    title: `Nhận phòng ${choice.hotel.name}`,
    location: choice.hotel.address,
    notes: `${choice.roomType.name} · ${choice.ratePlan.name}`,
    hotel: { hotelId: choice.hotel.id, productId: choice.roomType.id, ratePlanCode: choice.ratePlan.code },
  });
  let checkIn = '14:00';
  if (clock <= '11:30') takeStop(1, '12:00', 'food');
  else if (clock > checkIn) checkIn = clock;
  items.push(hotelItem(1, checkIn, choices[0]!));
  if (checkIn <= '15:30') takeStop(1, addMinutes(checkIn, 120), 'fun');
  const dinner = checkIn > '18:00' ? addMinutes(checkIn, 60) : '19:00';
  if (dinner <= '21:00') takeStop(1, dinner, 'food');
  if (dinner < '20:30' && random.next() < 0.4) takeStop(1, '21:00', 'cafe');

  // Các ngày giữa: sáng cà phê, chơi, trưa ăn; ngày đổi khách sạn thì nhận phòng mới lúc 14:00.
  let day = 2;
  choices.forEach((choice, index) => {
    for (let night = index === 0 ? 1 : 0; night < nightsPerHotel[index]!; night++) {
      takeStop(day, '08:30', 'cafe');
      takeStop(day, '10:00', 'fun');
      takeStop(day, '12:00', 'food');
      if (night === 0) items.push(hotelItem(day, '14:00', choice));
      takeStop(day, '16:00', 'fun');
      takeStop(day, '19:00', 'food');
      if (random.next() < 0.4) takeStop(day, '21:00', 'cafe');
      day++;
    }
  });

  // Ngày cuối: cà phê sáng, chơi nếu còn thời gian, đi xe ra sân bay rồi bay về.
  takeStop(day, '08:00', 'cafe');
  const leaveAt = inbound ? addMinutes(inbound.departTime, -120 - (transfer?.minutes ?? 0)) : '15:00';
  if (leaveAt >= '11:00') takeStop(day, '09:30', 'fun');
  if (leaveAt >= '13:00') takeStop(day, '12:00', 'food');
  if (inbound) {
    if (transfer) {
      items.push({ day, time: leaveAt, title: `Di chuyển ${destination.name} → ${transfer.from}`, notes: transfer.note, transport: { mode: transfer.mode } });
    }
    items.push({
      day,
      time: inbound.departTime,
      title: flightTitle(inbound),
      notes: random.pick(['Ra sân bay trước 90 phút', 'Chuyến chiều cho kịp mua quà', 'Gửi đồ ở khách sạn sau khi trả phòng']),
      transport: { mode: 'flight', fromAirport: inbound.fromAirport, toAirport: inbound.toAirport },
    });
  }
  items.sort((a, b) => a.day - b.day || (a.time ?? '').localeCompare(b.time ?? ''));

  const roomCost = choices.reduce((sum, c, i) => sum + c.hotel.basePrice * nightsPerHotel[i]!, 0) / 2;
  const flightCost = (outbound?.basePrice ?? 0) + (inbound?.basePrice ?? 0);
  const dailySpend = random.int(25, 70) * 10_000 * daysCount;
  const first = choices[0]!;
  const trip: TripAttachmentData = {
    hotelId: first.hotel.id,
    hotelName: first.hotel.name,
    hotelProductId: first.roomType.id,
    hotelRatePlanCode: first.ratePlan.code,
    destinationName: destination.name,
    daysCount,
    estimatedCostPerPerson: roundTo(roomCost + flightCost + dailySpend, 50_000),
    priceDisclaimer: 'Giá chỉ mang tính chất tham khảo',
    items,
  };
  return { trip, hotelNames: choices.map((c) => c.hotel.name), stopNames };
}

function placeName(video: ReelVideo, destination: ReelDestination | undefined): string {
  return destination?.name ?? video.location.split(',')[0]!.trim();
}

/**
 * Sinh 1000 reel mẫu dùng lại 60 video: mỗi bài có video riêng (chủ là người đăng) trỏ vào HLS dùng chung,
 * nội dung không trùng nhau, 400 bài có lộ trình với 1–5 điểm đặt được (khách sạn, chuyến bay có thật trong catalog).
 */
export function generateReelSeed(input: GenerateReelsInput): ContentSeed {
  const postCount = input.postCount ?? REEL_POST_COUNT;
  const tripCount = input.tripCount ?? REEL_TRIP_COUNT;
  if (input.authorIds.length < 2) throw new Error('Cần ít nhất 2 tài khoản để tạo reel mẫu');
  const random = createRandom(RANDOM_SEED);
  const destinations = new Map(REEL_DESTINATIONS.map((d) => [d.key, d]));
  const order = buildVideoOrder(input.videos, postCount, random);
  const domesticSlots = order.flatMap((v, i) => (v.destinationKey && destinations.has(v.destinationKey) ? [i] : []));
  if (domesticSlots.length < tripCount) throw new Error(`Chỉ có ${domesticSlots.length} bài trong nước, không đủ ${tripCount} lộ trình`);
  const tripSlots = new Set(random.sample(domesticSlots, tripCount));

  // Mỗi tài khoản có ít nhất một bài, phần còn lại lệch như mạng thật: vài người đăng nhiều.
  const authors = random.shuffle(input.authorIds);
  const weights = authors.map((_, i) => 1 / Math.pow(i + 3, 0.7));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pickAuthor = () => {
    let roll = random.next() * totalWeight;
    for (let i = 0; i < authors.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return authors[i]!;
    }
    return authors[authors.length - 1]!;
  };

  const seed: ContentSeed = { mediaAssets: [], posts: [], comments: [], reactions: [], bookmarks: [] };
  const usedTitles = new Set<string>();
  const usedBodies = new Set<string>();
  const stepMs = (REEL_SPREAD_DAYS * 86_400_000) / postCount;
  let commentIndex = 0;
  let reactionIndex = 0;
  let bookmarkIndex = 0;

  order.forEach((video, i) => {
    const authorId = i < authors.length ? authors[i]! : pickAuthor();
    const destination = video.destinationKey ? destinations.get(video.destinationKey) : undefined;
    const place = placeName(video, destination);
    const built = tripSlots.has(i) && destination ? buildTrip(destination, input, random) : null;
    const days = built?.trip.daysCount ?? random.int(1, 4);

    let title = '';
    for (let attempt = 0; attempt < 50 && (!title || usedTitles.has(title)); attempt++) {
      title = random.pick(TITLE_TEMPLATES)(place, Math.max(2, days), random.pick(GROUPS), random.pick(SEASONS));
    }
    if (usedTitles.has(title)) title = `${title} (phần ${i + 1})`;
    usedTitles.add(title);

    let body = '';
    for (let attempt = 0; attempt < 50 && (!body || usedBodies.has(body)); attempt++) {
      const parts = [random.pick(OPENERS), ...random.sample(video.script, random.int(1, 2))];
      if (built) {
        parts.push(`Chuyến ${built.trip.daysCount} ngày, mình ở ${built.hotelNames.join(' rồi chuyển sang ')}.`);
        if (built.stopNames.length > 0) parts.push(`Thích nhất là ${random.sample(built.stopNames, Math.min(2, built.stopNames.length)).join(' và ')}.`);
        parts.push(`Tổng chi phí khoảng ${formatMoney(built.trip.estimatedCostPerPerson!)} mỗi người, lộ trình chi tiết mình gắn bên dưới.`);
      } else {
        parts.push(`Ngân sách tham khảo: ${video.budget}.`);
      }
      parts.push(`Mẹo nhỏ: ${video.tip}`, random.pick(CLOSERS));
      body = parts.join(' ');
    }
    usedBodies.add(body);

    const hashtags = [
      ...(destination?.hashtags ?? [toTag(place), 'dulichnuocngoai']),
      toTag(video.category.replace(/_/g, ' ')),
      ...random.sample(['dulichvietnam', 'reviewdulich', 'tripflix', 'checkin', 'xuhuong', 'dulichtutuc', 'reels', 'amthuc', 'dulichgiare', 'chill'], random.int(2, 4)),
    ].filter((tag, index, all) => tag && all.indexOf(tag) === index);

    const postId = reelSeedId('post', i + 1);
    const mediaId = reelSeedId('media', i + 1);
    const publishedAt = new Date(input.now.getTime() - i * stepMs - random.int(0, Math.floor(stepMs * 0.8)));
    seed.mediaAssets.push({ id: mediaId, ownerId: authorId, status: 'ready', ...video.media });

    // Tương tác lệch như thật: đa số vài chục, ít bài vài trăm (tối đa số tài khoản có).
    const others = input.authorIds.filter((id) => id !== authorId);
    const likeCount = Math.min(others.length, Math.floor(Math.exp(2.6 + 1.0 * random.normal())));
    const reactors = random.sample(others, likeCount);
    const reactionCounts: Record<string, number> = {};
    for (const userId of reactors) {
      const roll = random.next();
      const type = roll < 0.7 ? 'like' : roll < 0.9 ? 'love' : 'helpful';
      reactionCounts[type] = (reactionCounts[type] ?? 0) + 1;
      seed.reactions.push({ id: reelSeedId('reaction', ++reactionIndex), postId, userId, type });
    }
    const savers = random.sample(others, Math.floor(likeCount * (0.1 + random.next() * 0.2)));
    for (const userId of savers) seed.bookmarks.push({ id: reelSeedId('bookmark', ++bookmarkIndex), postId, userId });

    const commentTotal = Math.min(others.length, Math.floor(likeCount / 8) + random.int(0, 2));
    let commentsOnPost = 0;
    for (let c = 0; c < commentTotal; c++) {
      const commentId = reelSeedId('comment', ++commentIndex);
      const createdAt = new Date(Math.min(input.now.getTime(), publishedAt.getTime() + random.int(10, 4320) * 60_000));
      seed.comments.push({
        id: commentId,
        postId,
        authorId: random.pick(others),
        parentCommentId: null,
        body: random.pick(COMMENTS).replace('{dest}', place).replace('{stop}', built?.stopNames[0] ?? place),
        isEdited: false,
        createdAt: createdAt.toISOString(),
      });
      commentsOnPost++;
      if (random.next() < 0.3) {
        seed.comments.push({
          id: reelSeedId('comment', ++commentIndex),
          postId,
          authorId,
          parentCommentId: commentId,
          body: random.pick(REPLIES),
          isEdited: false,
          createdAt: new Date(Math.min(input.now.getTime(), createdAt.getTime() + random.int(5, 600) * 60_000)).toISOString(),
        });
        commentsOnPost++;
      }
    }

    seed.posts.push({
      id: postId,
      authorId,
      postType: 'video',
      title,
      body,
      hashtags,
      status: 'published',
      visibility: 'public',
      // Không có đơn thật nên không gắn tích "Đã đi".
      isVerified: false,
      mediaIds: [mediaId],
      coverMediaId: null,
      tripAttachment: built?.trip ?? null,
      reactionCounts,
      reactionTotal: likeCount,
      commentCount: commentsOnPost,
      shareCount: Math.floor(likeCount * random.next() * 0.3),
      bookmarkCount: savers.length,
      publishedAt: publishedAt.toISOString(),
      createdAt: publishedAt.toISOString(),
      updatedAt: publishedAt.toISOString(),
    });
  });

  return seed;
}
