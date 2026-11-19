import type { SavedItineraryItemData, TripAttachmentData, TripItineraryItem } from '../../db/schema/index.js';

/**
 * Lộ trình khách lưu (TF105): chỉ theo Ngày 1..N, không ngày thật, không giá; ngày đi khách chọn lúc đặt.
 * Cùng dạng điểm với lộ trình của reel, thêm vài trường tuỳ chọn để nhận đủ dữ liệu Tripi và màn tự lên lộ trình.
 */
export type SavedItineraryItem = SavedItineraryItemData;

export type SavedItinerarySource = 'reel' | 'tripi' | 'builder';

export interface SavedItineraryDraft {
  title: string;
  destinationName: string | null;
  destinationPlaceId: string | null;
  daysCount: number;
  items: SavedItineraryItem[];
  source: SavedItinerarySource;
  sourcePostId: string | null;
}

export const MAX_ITINERARY_DAYS = 14;
export const MAX_ITINERARY_ITEMS = 80;
export const MAX_TITLE_LENGTH = 120;

/** Lộ trình không có điểm nào thì không lưu. */
export class EmptyItineraryError extends Error {
  constructor() {
    super('Lộ trình chưa có điểm nào để lưu.');
  }
}

const clip = (value: string, length: number) => value.trim().slice(0, length);
const DAY_MS = 86_400_000;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS);

function finish(draft: Omit<SavedItineraryDraft, 'daysCount'> & { daysCount?: number }): SavedItineraryDraft {
  const items = draft.items.filter((i) => i.day >= 1 && i.day <= MAX_ITINERARY_DAYS && i.title.trim()).slice(0, MAX_ITINERARY_ITEMS);
  if (!items.length) throw new EmptyItineraryError();
  const lastDay = Math.max(...items.map((i) => i.day));
  const daysCount = Math.min(MAX_ITINERARY_DAYS, Math.max(lastDay, draft.daysCount ?? 0));
  return { ...draft, title: clip(draft.title || 'Lộ trình của tôi', MAX_TITLE_LENGTH), daysCount, items };
}

/** Từ reel: chép nguyên điểm của tác giả (bản sao, khách sửa được), giữ link về reel. */
export function fromReel(post: { id: string; title: string; tripAttachment: TripAttachmentData | null }): SavedItineraryDraft {
  const trip = post.tripAttachment;
  return finish({
    title: post.title || trip?.destinationName || '',
    destinationName: trip?.destinationName ?? null,
    destinationPlaceId: trip?.destinationPlaceId ?? null,
    daysCount: trip?.daysCount,
    items: (trip?.items ?? []).map((item) => ({ ...item })),
    source: 'reel',
    sourcePostId: post.id,
  });
}

/** Phần lộ trình Tripi trả về (sự kiện `trip` của ai-service, camelCase). Chỉ đọc các trường cần, còn lại bỏ qua. */
export interface TripiTrip {
  place?: string;
  days?: { id: string; name: string; lat?: number; lng?: number; slot?: SavedItineraryItem['slot'] }[][];
  stay?: { source: 'tripflix' | 'external'; id: string; name: string } | null;
  transport?: TripiTransport | null;
  returnTransport?: TripiTransport | null;
}
interface TripiTransport {
  mode: 'flight' | 'bus';
  summary: string;
  fromAirport?: string | null;
  toAirport?: string | null;
}

const SLOT_ORDER = { sáng: 0, trưa: 1, chiều: 2, tối: 3 } as const;

function transportItem(day: number, transport: TripiTransport): SavedItineraryItem {
  const route = transport.fromAirport && transport.toAirport ? `${transport.fromAirport} → ${transport.toAirport}` : null;
  return {
    day,
    title: route ? `${transport.mode === 'flight' ? 'Bay' : 'Xe'} ${route}` : clip(transport.summary, 120),
    transport: { mode: transport.mode, ...(transport.fromAirport && { fromAirport: transport.fromAirport }), ...(transport.toAirport && { toAirport: transport.toAirport }) },
  };
}

/** Từ Tripi: ngày theo thứ tự, điểm giữ buổi và toạ độ; chỗ ở thành điểm khách sạn Ngày 1; bỏ ngày thật, giá, mã chuyến. */
export function fromTripi(trip: TripiTrip, title?: string): SavedItineraryDraft {
  const days = trip.days ?? [];
  const lastDay = Math.max(days.length, 1);
  const items: SavedItineraryItem[] = [];
  if (trip.transport) items.push(transportItem(1, trip.transport));
  if (trip.stay) {
    items.push({
      day: 1,
      title: clip(trip.stay.name, 120),
      ...(trip.stay.source === 'tripflix' && { hotel: { hotelId: trip.stay.id } }),
    });
  }
  days.forEach((stops, index) => {
    const sorted = [...stops].sort((a, b) => SLOT_ORDER[a.slot ?? 'sáng'] - SLOT_ORDER[b.slot ?? 'sáng']);
    for (const stop of sorted) {
      items.push({
        day: index + 1,
        title: clip(stop.name, 120),
        ...(stop.slot && { slot: stop.slot }),
        ...(stop.lat !== undefined && stop.lng !== undefined && { lat: stop.lat, lng: stop.lng }),
        placeId: stop.id,
      });
    }
  });
  if (trip.returnTransport) items.push(transportItem(lastDay, trip.returnTransport));
  return finish({
    title: title || (trip.place ? `${trip.place} ${lastDay} ngày` : ''),
    destinationName: trip.place || null,
    destinationPlaceId: null,
    daysCount: days.length,
    items,
    source: 'tripi',
    sourcePostId: null,
  });
}

/** Màn tự lên lộ trình (app và web): thẻ theo ngày thật. */
export interface BuilderTrip {
  destinationName?: string;
  destinationPlaceId?: string;
  startDate?: string;
  dayCount?: number;
  items: (
    | { kind: 'hotel'; checkIn: string; nights: number; hotelId: string; hotelName: string; productId?: string; ratePlanCode?: string }
    | { kind: 'flight'; date: string; from: string; to: string; departTime?: string | null }
    | { kind: 'activity'; date: string; time?: string; title: string; category?: TripItineraryItem['category']; detail?: string }
  )[];
}

const itemDate = (item: BuilderTrip['items'][number]) => (item.kind === 'hotel' ? item.checkIn : item.date);

/** Từ màn tự lên lộ trình: đổi ngày thật thành Ngày 1..N tính từ ngày sớm nhất; bỏ giá, giữ khách sạn, loại phòng, chặng bay. */
export function fromBuilder(builder: BuilderTrip, title?: string): SavedItineraryDraft {
  const dates = builder.items.map(itemDate).sort();
  const first = builder.startDate && (!dates[0] || builder.startDate < dates[0]) ? builder.startDate : dates[0];
  const dayOf = (date: string) => (first ? dayDiff(first, date) + 1 : 1);
  const items = builder.items.map((item): SavedItineraryItem => {
    if (item.kind === 'hotel') {
      return {
        day: dayOf(item.checkIn),
        time: '14:00',
        title: clip(item.hotelName, 120),
        nights: item.nights,
        hotel: { hotelId: item.hotelId, ...(item.productId && { productId: item.productId }), ...(item.ratePlanCode && { ratePlanCode: item.ratePlanCode }) },
      };
    }
    if (item.kind === 'flight') {
      return {
        day: dayOf(item.date),
        ...(item.departTime && { time: item.departTime.slice(0, 5) }),
        title: `Bay ${item.from} → ${item.to}`,
        transport: { mode: 'flight', fromAirport: item.from, toAirport: item.to },
      };
    }
    return {
      day: dayOf(item.date),
      ...(item.time && { time: item.time }),
      title: clip(item.title, 120),
      ...(item.category && { category: item.category }),
      ...(item.detail && { location: clip(item.detail, 200) }),
    };
  });
  items.sort((a, b) => a.day - b.day || (a.time ?? '').localeCompare(b.time ?? ''));
  return finish({
    title: title || (builder.destinationName ? `${builder.destinationName} ${Math.max(...items.map((i) => i.day), builder.dayCount ?? 0)} ngày` : ''),
    destinationName: builder.destinationName || null,
    destinationPlaceId: builder.destinationPlaceId || null,
    daysCount: builder.dayCount,
    items,
    source: 'builder',
    sourcePostId: null,
  });
}
