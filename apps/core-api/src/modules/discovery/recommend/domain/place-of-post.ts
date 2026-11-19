import { destOf } from '../../search/domain/explore/text.js';
import { placeIdOfName } from '../../search/domain/places.js';

export interface PostPlaceInput {
  hotelId: string | null;
  destinationName: string | null;
  title: string;
}

/**
 * placeId của bài, theo thứ tự: tỉnh của khách sạn gắn bài (từ listCatalog) → nơi nhận ra trong destinationName + title
 * (như postToObject của tìm khám phá) → null. destOf trả tên nơi của lexicon nên đổi về id PLACES;
 * nơi có trong lexicon mà không có trong PLACES (Cô Tô, Hà Giang, Sa Pa) thì null.
 */
export function placeIdOfPost(post: PostPlaceInput, hotelProvinces: ReadonlyMap<string, string>): string | null {
  const fromHotel = post.hotelId ? hotelProvinces.get(post.hotelId) : undefined;
  if (fromHotel) return fromHotel;
  const name = destOf(`${post.destinationName ?? ''} ${post.title}`);
  return name ? placeIdOfName(name) : null;
}

/** Mã loại phòng của commerce là `<mã khách sạn>--<mã phòng>`: đơn ghi mã phòng, nơi thì tra theo khách sạn. */
export const hotelIdOfProduct = (productId: string): string => productId.split('--')[0]!;

/** Nơi (tỉnh) của sản phẩm trong đơn: tra mã phòng trước, không có thì tra khách sạn chứa phòng đó. */
export function placeOfProduct(productPlaces: Record<string, string>, productId: string): string | undefined {
  return productPlaces[productId] ?? productPlaces[hotelIdOfProduct(productId)];
}
