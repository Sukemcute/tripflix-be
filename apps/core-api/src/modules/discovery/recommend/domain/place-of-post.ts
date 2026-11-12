import { destOf } from '../../search/domain/explore/text.js';
import { normalizeText } from '../../search/domain/normalize-text.js';
import { PLACES } from '../../search/domain/places.js';

/** Tên/bí danh đã chuẩn hoá → id PLACES (trùng provinceSlug của commerce, placeId của /api/stays). */
const PLACE_ID_BY_NAME = new Map(PLACES.flatMap((p) => [p.name, ...p.aliases].map((n) => [normalizeText(n), p.id] as const)));

export interface PostPlaceInput {
  hotelId: string | null;
  destinationName: string | null;
  title: string;
}

/**
 * placeId của bài, theo thứ tự: tỉnh của khách sạn gắn bài (từ listCatalog) → nơi nhận ra trong destinationName + title
 * (như postToObject của tìm khám phá) → null. destOf trả tên nơi của lexicon nên đổi về id PLACES;
 * nơi có trong lexicon mà không có trong PLACES (Cô Tô, Hà Giang, Sa Pa, Vũng Tàu) thì null.
 */
export function placeIdOfPost(post: PostPlaceInput, hotelProvinces: ReadonlyMap<string, string>): string | null {
  const fromHotel = post.hotelId ? hotelProvinces.get(post.hotelId) : undefined;
  if (fromHotel) return fromHotel;
  const name = destOf(`${post.destinationName ?? ''} ${post.title}`);
  return name ? (PLACE_ID_BY_NAME.get(normalizeText(name)) ?? null) : null;
}
