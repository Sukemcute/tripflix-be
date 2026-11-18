import { PLACES } from '../../search/domain/places.js';
import { round4, type Kind, type PostMeta, type RawRow } from './contracts.js';
import { COST_PER_PERSON, costBin, lenBin, PRICE_PER_NIGHT } from './topics.js';

/**
 * Câu trả lời TỨC THỜI của người dùng (TF28 v1), tính lúc gọi từ bảng thô vài ngày gần nhất, vì phụ thuộc "hôm nay":
 * H1a đang nhắm đi đâu · H1c đã đặt gì · H3/H4/H5 từ tìm phòng và đơn · H0 giai đoạn chuyến đi.
 * Hàm thuần: use case chỉ đưa dòng thô 30 ngày của người xem, mọi luật nằm ở đây. Đổi luật = sửa file này.
 */

export type Stage = 'dreaming' | 'planning' | 'upcoming' | 'on_trip' | 'after_trip';

export interface BookedTrip {
  placeId: string;
  hotelId: string | null;
  /** YYYY-MM-DD */
  checkIn: string;
  nights: number;
}

export interface LiveAnswers {
  stage: Stage;
  /** Chuyến quyết định giai đoạn (sắp đi / đang đi / vừa về). */
  trip: BookedTrip | null;
  /** H1a: ngăn place:* → trọng số đã nhạt dần (kèm tỉnh cha). */
  exploring: Record<string, number>;
  /** H3, H4, H5 từ tìm phòng / tìm kiếm / đơn: ngăn → trọng số. */
  budget: Record<string, number>;
  party: Record<string, number>;
  len: Record<string, number>;
  /** câu hỏi → tổng trọng số dấu hiệu (độ tin). */
  evidence: Record<'exploring' | 'budget' | 'party' | 'len', number>;
}

/** Cửa sổ đọc dòng thô và các trọng số dấu hiệu "đang tìm hiểu". */
export const LIVE_WINDOW_DAYS = 14;
const HALF_LIFE_DAYS = 2;
const SIGNAL = { search: 1, staysSearch: 3, productView: 2, postBurst: 1 };
/** Lên kế hoạch khi một nơi có ≥ ngưỡng này (≈ 2 lượt tìm gần đây, hoặc 1 lượt tìm phòng). */
export const PLANNING_MIN_EVIDENCE = 1.5;
const AFTER_TRIP_DAYS = 14;
/** Tìm / tìm phòng / xem cùng một nơi nhiều lần trong một giờ chỉ tính một lần: bấm lại, đổi bộ lọc, tải lại trang không phải thêm quan tâm. */
const DEDUPE_MS = 3_600_000;
const DEDUPE_KINDS = new Set<Kind>(['search', 'stays_search', 'view']);
const POST_KINDS = new Set<Kind>(['reaction', 'bookmark', 'comment', 'share']);
const PRODUCT_TARGETS = new Set(['hotel', 'room', 'stay', 'product']);

const DAY = 86_400_000;
const PARENT = new Map(PLACES.map((p) => [p.id, p.parentId]));
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const add = (m: Record<string, number>, k: string, w: number) => (m[k] = (m[k] ?? 0) + w);
const roundAll = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round4(v)]));

function bookedTrip(row: RawRow, productPlaces: Record<string, string>): BookedTrip | null {
  if (row.kind !== 'order_item' || row.isRemoved || !row.targetType || !PRODUCT_TARGETS.has(row.targetType)) return null;
  const placeId = (row.targetId ? productPlaces[row.targetId] : undefined) ?? str(row.detail?.placeId);
  const checkIn = str(row.detail?.date);
  if (!placeId || !checkIn) return null;
  return { placeId, hotelId: row.targetId, checkIn, nights: num(row.detail?.nights) ?? 1 };
}

/** Giai đoạn theo chuyến đã đặt; ưu tiên đang đi > sắp đi (gần nhất) > vừa về (gần nhất). */
function stageOfTrips(trips: BookedTrip[], now: Date): { stage: Stage; trip: BookedTrip } | null {
  const today = Date.parse(now.toISOString().slice(0, 10));
  const span = (t: BookedTrip) => ({ t, from: Date.parse(t.checkIn), to: Date.parse(t.checkIn) + t.nights * DAY });
  const spans = trips.map(span);
  const onTrip = spans.find((s) => s.from <= today && today <= s.to);
  if (onTrip) return { stage: 'on_trip', trip: onTrip.t };
  const upcoming = spans.filter((s) => s.from > today).sort((a, b) => a.from - b.from)[0];
  if (upcoming) return { stage: 'upcoming', trip: upcoming.t };
  const after = spans.filter((s) => s.to < today && today - s.to <= AFTER_TRIP_DAYS * DAY).sort((a, b) => b.to - a.to)[0];
  return after ? { stage: 'after_trip', trip: after.t } : null;
}

export function answerLive(input: { rows: RawRow[]; posts: Record<string, PostMeta>; productPlaces: Record<string, string>; now: Date }): LiveAnswers {
  const { now, productPlaces, posts } = input;
  const since = now.getTime() - LIVE_WINDOW_DAYS * DAY;
  const seenSignal = new Set<string>();
  const rows = input.rows
    .filter((r) => !r.isRemoved && Date.parse(r.occurredAt) >= since && Date.parse(r.occurredAt) <= now.getTime())
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .filter((r) => {
      if (!DEDUPE_KINDS.has(r.kind)) return true;
      const key = `${r.kind}|${r.targetId ?? str((r.detail?.placeIds as unknown[] | undefined)?.[0]) ?? ''}|${Math.floor(Date.parse(r.occurredAt) / DEDUPE_MS)}`;
      if (seenSignal.has(key)) return false;
      seenSignal.add(key);
      return true;
    });
  const decay = (r: RawRow) => 0.5 ** ((now.getTime() - Date.parse(r.occurredAt)) / DAY / HALF_LIFE_DAYS);

  const places: Record<string, number> = {};
  const budget: Record<string, number> = {};
  const party: Record<string, number> = {};
  const len: Record<string, number> = {};
  const evidence = { exploring: 0, budget: 0, party: 0, len: 0 };
  const note = (m: Record<string, number>, key: keyof typeof evidence, bin: string, w: number) => {
    add(m, bin, w);
    evidence[key] += w;
  };

  for (const r of rows) {
    const w = decay(r);
    if (r.kind === 'search') {
      const placeId = r.targetId ?? str((r.detail?.placeIds as unknown[] | undefined)?.[0]);
      if (placeId) note(places, 'exploring', placeId, SIGNAL.search * w);
      const budgetMax = num(r.detail?.budgetMax);
      if (budgetMax) note(budget, 'budget', costBin(budgetMax, COST_PER_PERSON), w);
    } else if (r.kind === 'stays_search') {
      if (r.targetId) note(places, 'exploring', r.targetId, SIGNAL.staysSearch * w);
      const priceMax = num(r.detail?.priceMax);
      if (priceMax) note(budget, 'budget', costBin(priceMax, PRICE_PER_NIGHT), w);
      if ((num(r.detail?.minStars) ?? 0) >= 4) note(budget, 'budget', 'cost:cao_cap', w);
      const adults = num(r.detail?.adults);
      const rooms = num(r.detail?.rooms) ?? 1;
      // Không phân biệt được gia đình (sự kiện không có trẻ em): 3+ người tính là nhóm.
      if (adults) note(party, 'party', adults === 1 ? 'with:mot_minh' : adults === 2 && rooms <= 1 ? 'with:cap_doi' : 'with:nhom_ban', w);
      const checkIn = str(r.detail?.checkIn);
      const checkOut = str(r.detail?.checkOut);
      if (checkIn && checkOut) note(len, 'len', lenBin(Math.max(1, (Date.parse(checkOut) - Date.parse(checkIn)) / DAY) + 1), w);
    } else if (r.kind === 'view') {
      const placeId = str(r.detail?.placeId) ?? (r.targetId ? productPlaces[r.targetId] : undefined);
      if (placeId) note(places, 'exploring', placeId, SIGNAL.productView * w);
    } else if (r.kind === 'order_item') {
      const nights = num(r.detail?.nights);
      if (nights) note(len, 'len', lenBin(nights + 1), w);
    }
  }

  // Thích từ 2 bài cùng nơi trong 1 ngày: đang tìm hiểu nơi đó, không chỉ thích chung chung.
  const postHits = rows
    .filter((r) => POST_KINDS.has(r.kind) && r.targetType === 'post' && r.targetId && posts[r.targetId]?.placeId)
    .map((r) => ({ r, postId: r.targetId!, placeId: posts[r.targetId!]!.placeId!, at: Date.parse(r.occurredAt) }));
  for (const hit of postHits) {
    const burst = postHits.some((o) => o.placeId === hit.placeId && o.postId !== hit.postId && Math.abs(o.at - hit.at) <= DAY);
    if (burst) note(places, 'exploring', hit.placeId, SIGNAL.postBurst * decay(hit.r));
  }

  const exploring: Record<string, number> = {};
  for (const [placeId, w] of Object.entries(places)) {
    add(exploring, `place:${placeId}`, w);
    const parent = PARENT.get(placeId);
    if (parent) add(exploring, `place:${parent}`, w);
  }

  // Đơn trả tiền trước cửa sổ vẫn có thể là chuyến sắp tới / vừa về: xét mọi đơn được đưa vào (giai đoạn theo ngày đi, không theo ngày đặt).
  const booked = stageOfTrips(input.rows.flatMap((r) => bookedTrip(r, productPlaces) ?? []), now);
  const topPlace = Math.max(0, ...Object.values(places));
  const stage: Stage = booked?.stage ?? (topPlace >= PLANNING_MIN_EVIDENCE ? 'planning' : 'dreaming');

  return {
    stage,
    trip: booked?.trip ?? null,
    exploring: roundAll(exploring),
    budget: roundAll(budget),
    party: roundAll(party),
    len: roundAll(len),
    evidence: roundAll(evidence) as LiveAnswers['evidence'],
  };
}
