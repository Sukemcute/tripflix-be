import { createHash } from 'node:crypto';
import type { Kind, RawRow } from '../domain/contracts.js';

/** Một bài trong fixture (dump từ DB local, xem fixtures/README trong spec). */
export interface EvalPost {
  postId: string;
  authorId: string;
  postType: string;
  tags: string[];
  placeId: string | null;
  isVerified: boolean;
  hasPlan: boolean;
  publishedAt: string;
  title: string;
  body: string;
  trip: {
    destinationName: string | null;
    daysCount: number | null;
    estimatedCostPerPerson: number | null;
    hotelId: string | null;
    items: Array<{ day: number | null; location: string | null; category: string | null }>;
  } | null;
  hot: number | null;
  completeness: number | null;
}

export type Stage = 'dreaming' | 'planning' | 'upcoming' | 'on_trip' | 'after_trip' | 'guest';

/**
 * Người dùng giả lập. Mỗi persona khai đúng câu trả lời mong muốn để bộ đo chấm:
 * targetPlaces: top 10 nên nhiều bài ở đây; avoidPlaces: top 10 nên ít bài ở đây; holdout: bài người đó sẽ tương tác tiếp.
 */
export interface Persona {
  id: string;
  stage: Stage;
  note: string;
  rows: RawRow[];
  /** productId khách sạn → placeId cho dòng order_item. */
  productPlaces: Record<string, string>;
  targetPlaces: string[];
  avoidPlaces: string[];
  /** Khách sạn đã đặt: bài gắn khách sạn khác ở nơi đã đặt bị đếm. */
  bookedHotelId: string | null;
  holdout: string[];
}

/** "Hôm nay" của bộ đo: sau bài mới nhất trong fixture (12/11 15:27Z) chưa tới 48 giờ, để nguồn bài mới có bài. */
export const EVAL_NOW = new Date('2026-11-13T00:00:00Z');

const DAY = 86_400_000;
const hash = (s: string) => createHash('md5').update(s).digest().readUInt32BE(0);
const at = (daysAgo: number) => new Date(EVAL_NOW.getTime() - daysAgo * DAY).toISOString();
const isoDate = (daysFromNow: number) => new Date(EVAL_NOW.getTime() + daysFromNow * DAY).toISOString().slice(0, 10);

/** Chọn n bài tất định theo băm(seed + postId): cùng seed thì cùng kết quả. */
function pick(posts: EvalPost[], seed: string, n: number): EvalPost[] {
  return [...posts].sort((a, b) => hash(seed + a.postId) - hash(seed + b.postId) || a.postId.localeCompare(b.postId)).slice(0, n);
}

const hasTag = (...tags: string[]) => (p: EvalPost) => p.tags.some((t) => tags.includes(t.trim().toLowerCase()));
const atPlace = (...places: string[]) => (p: EvalPost) => p.placeId !== null && places.includes(p.placeId);

function row(userId: string, kind: Kind, refId: string, daysAgo: number, rest: Partial<RawRow> = {}): RawRow {
  return { actorType: 'user', actorId: userId, kind, refId, targetType: null, targetId: null, value: null, isRemoved: false, detail: null, occurredAt: at(daysAgo), ...rest };
}

/** Tương tác lên bài, rải đều trong [fromDays, toDays] ngày trước; kind xoay vòng react → lưu → comment. */
function engage(userId: string, posts: EvalPost[], fromDays: number, toDays: number): RawRow[] {
  const kinds: Kind[] = ['reaction', 'reaction', 'bookmark', 'comment'];
  return posts.map((p, i) => {
    const daysAgo = fromDays + ((toDays - fromDays) * i) / Math.max(1, posts.length - 1);
    return row(userId, kinds[i % kinds.length]!, `${kinds[i % kinds.length]}:${p.postId}`, daysAgo, { targetType: 'post', targetId: p.postId });
  });
}

const searches = (userId: string, placeId: string, count: number, fromDays: number, toDays: number): RawRow[] =>
  Array.from({ length: count }, (_, i) =>
    row(userId, 'search', `search:${placeId}:${i}`, fromDays + ((toDays - fromDays) * i) / Math.max(1, count - 1), {
      targetType: 'place',
      targetId: placeId,
      detail: { placeIds: [placeId], intent: null, budgetMax: null, surface: 'explore', postType: null },
    }),
  );

function order(userId: string, hotelId: string, checkInDaysFromNow: number, nights: number, paidDaysAgo: number): RawRow {
  return row(userId, 'order_item', `order:${hotelId}:0`, paidDaysAgo, {
    targetType: 'hotel',
    targetId: hotelId,
    detail: { orderId: `order:${hotelId}`, sourcePostId: null, date: isoDate(checkInDaysFromNow), nights, qty: 1, flight: null },
  });
}

/**
 * Tách n bài cuối (theo thời gian) ra làm đáp án: gu dựng từ phần còn lại.
 * Bài đáp án không nằm trong rows nên feed-policy không phạt "đã tương tác".
 */
function withHoldout(rows: RawRow[], posts: EvalPost[], n: number): { rows: RawRow[]; holdout: string[] } {
  const holdout = posts.slice(-n).map((p) => p.postId);
  const hidden = new Set(holdout);
  return { rows: rows.filter((r) => !(r.targetType === 'post' && r.targetId && hidden.has(r.targetId))), holdout };
}

/** ~12 persona cho 5 giai đoạn + khách. Chỉ dùng bài và nơi có thật trong fixture. */
export function buildPersonas(posts: EvalPost[]): Persona[] {
  const base = { productPlaces: {}, targetPlaces: [], avoidPlaces: [], bookedHotelId: null, holdout: [] };
  const personas: Persona[] = [];

  // Mơ: gu rõ theo trải nghiệm, không nhắm nơi nào. 10 tương tác trong 14 ngày, giữ 2 bài cuối làm đáp án.
  const dreamers: Array<[string, string, (p: EvalPost) => boolean]> = [
    ['mo-bien-capdoi', 'thích biển, đi cặp đôi', hasTag('bien', 'capdoi', 'dulichbien', 'bienvietnam')],
    ['mo-nui-phuot', 'thích núi, phượt, tiết kiệm', hasTag('nui', 'camping', 'phuot', 'tietkiem', 'sanmay')],
    ['mo-an-uong', 'thích ăn uống, đồ ăn đường phố', hasTag('anuong', 'streetfood', 'anvat', 'foodtour')],
    ['mo-van-hoa', 'thích văn hoá, phố cổ', hasTag('vanhoa', 'phoco', 'tamlinh')],
  ];
  for (const [id, note, match] of dreamers) {
    const liked = pick(posts.filter(match), id, 10);
    const { rows, holdout } = withHoldout(engage(id, liked, 14, 0.5), liked, 2);
    personas.push({ ...base, id, stage: 'dreaming', note, rows, holdout });
  }

  // Ca thật 18/11: react bài Nha Trang + Đà Lạt, nhưng tìm Hà Nội rất nhiều từ 10 ngày trước.
  {
    const id = 'ca-that-18-11';
    const liked = [...pick(posts.filter(atPlace('nha-trang')), id, 5), ...pick(posts.filter(atPlace('da-lat')), id, 5)];
    personas.push({
      ...base,
      id,
      // Thích liền nhiều bài Đà Lạt trong vài ngày gần đây = đang tìm hiểu Đà Lạt (luật "2 bài cùng nơi trong 1 ngày").
      stage: 'planning',
      note: 'react Nha Trang rồi Đà Lạt (9–1 ngày trước); 60 lượt tìm Hà Nội cách đây 10–12 ngày',
      rows: [...engage(id, liked, 9, 1), ...searches(id, 'ha-noi', 60, 12, 10)],
      targetPlaces: ['nha-trang', 'da-lat'],
    });
  }

  // Lên kế hoạch: gu cũ Đà Lạt, 2 ngày nay tìm Nha Trang và tìm phòng Nha Trang.
  {
    const id = 'kh-dalat-sang-nhatrang';
    const liked = pick(posts.filter(atPlace('da-lat')), id, 8);
    personas.push({
      ...base,
      id,
      stage: 'planning',
      note: 'thích Đà Lạt (14–5 ngày trước); 2 ngày nay tìm Nha Trang 3 lần + tìm phòng',
      rows: [
        ...engage(id, liked, 14, 5),
        ...searches(id, 'nha-trang', 3, 2, 0.2),
        row(id, 'stays_search', 'stays:nha-trang', 0.3, {
          targetType: 'place',
          targetId: 'nha-trang',
          detail: { checkIn: isoDate(10), checkOut: isoDate(12), adults: 2, rooms: 1, minStars: null, priceMax: 1_200_000 },
        }),
      ],
      targetPlaces: ['nha-trang'],
    });
  }
  // Lên kế hoạch, người mới: chưa tương tác gì, chỉ vừa tìm Phú Quốc.
  {
    const id = 'kh-moi-phuquoc';
    personas.push({ ...base, id, stage: 'planning', note: 'chưa tương tác, hôm nay tìm Phú Quốc 2 lần', rows: searches(id, 'phu-quoc', 2, 0.5, 0.1), targetPlaces: ['phu-quoc'] });
  }

  // Sắp đi: đã đặt khách sạn Nha Trang, nhận phòng sau 3 ngày; trước đó thích vài bài biển.
  {
    const id = 'sap-di-nhatrang';
    const liked = pick(posts.filter(hasTag('bien')), id, 6);
    personas.push({
      ...base,
      id,
      stage: 'upcoming',
      note: 'đặt P-h-nt-01 (Nha Trang), nhận phòng sau 3 ngày, 2 đêm',
      rows: [...engage(id, liked, 12, 4), ...searches(id, 'nha-trang', 2, 4, 3), order(id, 'P-h-nt-01', 3, 2, 2)],
      productPlaces: { 'P-h-nt-01': 'nha-trang' },
      targetPlaces: ['nha-trang'],
      bookedHotelId: 'P-h-nt-01',
    });
  }

  // Đang đi: ở Đà Lạt từ hôm qua, 3 đêm.
  {
    const id = 'dang-di-dalat';
    const liked = pick(posts.filter(hasTag('cafe', 'anuong')), id, 6);
    personas.push({
      ...base,
      id,
      stage: 'on_trip',
      note: 'đặt P-vn-h-da-lat-1 (Đà Lạt), nhận phòng hôm qua, 3 đêm',
      rows: [...engage(id, liked, 13, 3), order(id, 'P-vn-h-da-lat-1', -1, 3, 6)],
      productPlaces: { 'P-vn-h-da-lat-1': 'da-lat' },
      targetPlaces: ['da-lat'],
      bookedHotelId: 'P-vn-h-da-lat-1',
    });
  }

  // Vừa về: đi Phú Quốc, trả phòng 3 ngày trước; lúc lên kế hoạch thích nhiều bài Phú Quốc.
  {
    const id = 'vua-ve-phuquoc';
    const liked = [...pick(posts.filter(atPlace('phu-quoc')), id, 6), ...pick(posts.filter(hasTag('bien')), id, 3)];
    personas.push({
      ...base,
      id,
      stage: 'after_trip',
      note: 'đặt P-h-pq-01 (Phú Quốc), trả phòng 3 ngày trước; thích 6 bài Phú Quốc',
      rows: [...engage(id, liked, 20, 8), ...searches(id, 'phu-quoc', 4, 18, 12), order(id, 'P-h-pq-01', -6, 3, 15)],
      productPlaces: { 'P-h-pq-01': 'phu-quoc' },
      avoidPlaces: ['phu-quoc'],
      bookedHotelId: null,
    });
  }

  // Chỉ xem reels, không thả tim: xem gần hết bài biển (mỗi ngày một bài, không dồn), lướt qua bài ăn uống.
  {
    const id = 'mo-xem-reels-bien';
    const watched = pick(posts.filter(hasTag('bien', 'dulichbien', 'bienvietnam')), id, 8);
    const skipped = pick(posts.filter(hasTag('anuong', 'streetfood')), id, 6);
    const view = (p: EvalPost, daysAgo: number, ratio: number) =>
      row(id, 'view_post', p.postId, daysAgo, {
        targetType: 'post',
        targetId: p.postId,
        value: ratio,
        detail: { watchedMs: Math.round(ratio * 30_000), durationSec: 30, isQualified: ratio >= 0.5, surface: 'reels' },
      });
    const rows = [...watched.map((p, i) => view(p, 12 - i * 1.5, 0.92)), ...skipped.map((p, i) => view(p, 11 - i * 1.7, 0.03))];
    const { rows: kept, holdout } = withHoldout(rows, watched, 2);
    personas.push({ ...base, id, stage: 'dreaming', note: 'xem gần hết 8 reels biển (mỗi ngày một bài), lướt qua 6 reels ăn uống', rows: kept, holdout });
  }

  // Bấm "Đặt" trên lộ trình của một reels Đà Nẵng hôm nay, trước đó chỉ thích vài bài chung chung.
  {
    const id = 'kh-bam-dat-reels-danang';
    const liked = pick(posts.filter(hasTag('cafe')), id, 4);
    const target = pick(posts.filter(atPlace('da-nang')), id, 1)[0]!;
    personas.push({
      ...base,
      id,
      stage: 'planning',
      note: 'thích 4 bài cà phê (10–4 ngày trước); hôm nay bấm Đặt trên reels Đà Nẵng',
      rows: [
        ...engage(id, liked, 10, 4),
        row(id, 'booking_click', `click:${target.postId}`, 0.1, { targetType: 'post', targetId: target.postId, detail: { hotelId: null, surface: 'reels_trip_plan' } }),
      ],
      // Hội An thuộc tỉnh Đà Nẵng (sau sáp nhập): bài Hội An là "gần nơi đang nhắm", tính là đúng nơi.
      targetPlaces: ['da-nang', 'hoi-an'],
    });
  }

  personas.push({ ...base, id: 'khach', stage: 'guest', note: 'chưa đăng nhập', rows: [] });
  return personas;
}
