import { mostSpecificPlace, placesIn } from '../../search/domain/places.js';

export type PostPlaceSource = 'hotel' | 'placeId' | 'tag' | 'destination' | 'title' | 'body' | 'item';

export interface PostPlaceMatch {
  placeId: string;
  source: PostPlaceSource;
}

export interface PostPlaceInput {
  hotelId?: string | null;
  placeId?: string | null;
  tags?: readonly string[];
  destinationName?: string | null;
  title?: string | null;
  body?: string | null;
  items?: ReadonlyArray<{ location?: string | null }>;
}

/**
 * Tra một nguồn chung từ PLACES cho cả build-features và bins.ts theo đúng thứ tự:
 * khách sạn → placeId có sẵn → tag → destinationName → title → body → trip.items.
 */
export function resolvePostPlace(
  post: PostPlaceInput,
  hotelProvinces?: ReadonlyMap<string, string>,
): PostPlaceMatch | null {
  const fromHotel = post.hotelId && hotelProvinces ? hotelProvinces.get(post.hotelId) : undefined;
  if (fromHotel) return { placeId: fromHotel, source: 'hotel' };
  if (post.placeId) return { placeId: post.placeId, source: 'placeId' };

  const fromTag = post.tags?.length ? mostSpecificPlace(post.tags.flatMap((t) => placesIn(t))) : null;
  if (fromTag) return { placeId: fromTag, source: 'tag' };

  if (post.destinationName) {
    const fromDest = mostSpecificPlace(placesIn(post.destinationName));
    if (fromDest) return { placeId: fromDest, source: 'destination' };
  }
  if (post.title) {
    const fromTitle = mostSpecificPlace(placesIn(post.title));
    if (fromTitle) return { placeId: fromTitle, source: 'title' };
  }
  if (post.body) {
    const fromBody = mostSpecificPlace(placesIn(post.body));
    if (fromBody) return { placeId: fromBody, source: 'body' };
  }
  for (const item of post.items ?? []) {
    if (!item.location) continue;
    const fromItem = mostSpecificPlace(placesIn(item.location));
    if (fromItem) return { placeId: fromItem, source: 'item' };
  }
  return null;
}

/** placeId của bài theo thứ tự thống nhất với bins.ts (khách sạn → tag → destinationName → title → body → trip.items). */
export function placeIdOfPost(post: PostPlaceInput, hotelProvinces: ReadonlyMap<string, string>): string | null {
  return resolvePostPlace(post, hotelProvinces)?.placeId ?? null;
}

/** Mã loại phòng của commerce là `<mã khách sạn>--<mã phòng>`: đơn ghi mã phòng, nơi thì tra theo khách sạn. */
export const hotelIdOfProduct = (productId: string): string => productId.split('--')[0]!;

/** Nơi (tỉnh) của sản phẩm trong đơn: tra mã phòng trước, không có thì tra khách sạn chứa phòng đó. */
export function placeOfProduct(productPlaces: Record<string, string>, productId: string): string | undefined {
  return productPlaces[productId] ?? productPlaces[hotelIdOfProduct(productId)];
}
