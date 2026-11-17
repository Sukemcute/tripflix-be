import type { PostImage, PostMediaPort } from '../ports/post-media.port.js';

export type WithPostImages<T> = T & { images: PostImage[] };

export interface PostLike {
  postType: string;
  mediaIds: string[];
  tripAttachment?: { posterMediaId?: string; posterUrl?: string } | null;
}

/**
 * Gắn link ảnh của bài viết (vlog) vào bài trả về API, đúng thứ tự mediaIds. Một lần hỏi module media cho cả
 * trang. Reels không có ảnh nên luôn là mảng rỗng.
 */
export class PostImagesResolver {
  constructor(private readonly postMedia: PostMediaPort) {}

  async attach<T extends PostLike>(posts: T[]): Promise<Array<WithPostImages<T>>> {
    const imageIds = posts.filter((post) => post.postType === 'vlog').flatMap((post) => post.mediaIds);
    const posterIds = posts.flatMap((post) => (post.tripAttachment?.posterMediaId ? [post.tripAttachment.posterMediaId] : []));
    const allIds = [...imageIds, ...posterIds];
    const images = allIds.length > 0 ? await this.postMedia.getImages(allIds) : new Map<string, PostImage>();
    return posts.map((post) => ({
      ...post,
      ...withTripPoster(post, images),
      images:
        post.postType === 'vlog'
          ? post.mediaIds.flatMap((mediaId) => {
              const image = images.get(mediaId);
              return image ? [image] : [];
            })
          : [],
    }));
  }

  async attachOne<T extends PostLike>(post: T): Promise<WithPostImages<T>> {
    const [withImages] = await this.attach([post]);
    return withImages!;
  }

  /** Trang danh sách { items, ... }: giữ nguyên các trường khác. */
  async attachToPage<T extends PostLike, P extends { items: T[] }>(
    page: P,
  ): Promise<Omit<P, 'items'> & { items: Array<WithPostImages<T>> }> {
    return { ...page, items: await this.attach(page.items) };
  }
}

/** Poster lộ trình (TF105): đổi posterMediaId thành link; ảnh chưa sẵn sàng hoặc đã xoá thì bỏ qua để dùng poster video. */
function withTripPoster<T extends PostLike>(post: T, images: Map<string, PostImage>): Partial<Pick<T, 'tripAttachment'>> {
  const posterId = post.tripAttachment?.posterMediaId;
  const poster = posterId ? images.get(posterId) : undefined;
  return poster ? { tripAttachment: { ...post.tripAttachment!, posterUrl: poster.url } } : {};
}
