import { PostMediaNotAllowedException, type PostMediaInfo } from '../../domain/index.js';
import type { PostImage, PostMediaPort } from '../ports/post-media.port.js';
import { PostImagesResolver } from './post-images.js';
import { prepareTripAttachment } from './post-media.js';

const authorId = '018d9f00-user-7000-8000-000000000001';
const posterId = '018d9f30-img-7000-8000-000000000001';

function createPostMedia(
  mediaInfo: Record<string, PostMediaInfo>,
  images: Record<string, Omit<PostImage, 'id'>> = {},
): PostMediaPort {
  return {
    findMediaInfo: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (mediaInfo[id] ? [[id, mediaInfo[id]!]] : [])))),
    getImages: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (images[id] ? [[id, { id, ...images[id]! }]] : [])))),
  };
}

describe('prepareTripAttachment (TF105)', () => {
  it('bỏ posterUrl client gửi lên và giờ sai dạng, giữ giờ HH:mm hợp lệ', async () => {
    const prepared = await prepareTripAttachment(createPostMedia({}), authorId, {
      posterUrl: 'https://evil.example/x.png',
      items: [
        { day: 1, title: 'Bay', time: '06:45' },
        { day: 1, title: 'Ăn tối', time: '25:99' },
        { day: 2, title: 'Cáp treo' },
      ],
    });
    expect(prepared).toEqual({
      items: [{ day: 1, title: 'Bay', time: '06:45' }, { day: 1, title: 'Ăn tối' }, { day: 2, title: 'Cáp treo' }],
    });
  });

  it('giữ khách sạn của từng điểm, bỏ khách sạn thiếu mã và trường lạ', async () => {
    const prepared = await prepareTripAttachment(createPostMedia({}), authorId, {
      items: [
        { day: 1, title: 'Ana Mandara', hotel: { hotelId: 'h1', productId: 'h1--DLX', ratePlanCode: 'RO', x: 1 } as never },
        { day: 3, title: 'Vinpearl', hotel: { hotelId: 'h2' } },
        { day: 4, title: 'Sai', hotel: { hotelId: '' } },
      ],
    });
    expect(prepared?.items).toEqual([
      { day: 1, title: 'Ana Mandara', hotel: { hotelId: 'h1', productId: 'h1--DLX', ratePlanCode: 'RO' } },
      { day: 3, title: 'Vinpearl', hotel: { hotelId: 'h2' } },
      { day: 4, title: 'Sai' },
    ]);
  });

  it('nhận poster là ảnh đã tải xong của chính tác giả', async () => {
    const media = createPostMedia({ [posterId]: { kind: 'image', ownerId: authorId, status: 'ready' } });
    await expect(prepareTripAttachment(media, authorId, { posterMediaId: posterId })).resolves.toEqual({ posterMediaId: posterId });
  });

  it.each<[string, PostMediaInfo | undefined]>([
    ['không tồn tại', undefined],
    ['là video', { kind: 'video', ownerId: authorId, status: 'ready' }],
    ['của người khác', { kind: 'image', ownerId: 'someone-else', status: 'ready' }],
    ['chưa tải xong', { kind: 'image', ownerId: authorId, status: 'uploading' }],
  ])('chặn poster %s', async (_, info) => {
    const media = createPostMedia(info ? { [posterId]: info } : {});
    await expect(prepareTripAttachment(media, authorId, { posterMediaId: posterId })).rejects.toBeInstanceOf(PostMediaNotAllowedException);
  });

  it('không có lộ trình thì giữ nguyên null/undefined', async () => {
    await expect(prepareTripAttachment(createPostMedia({}), authorId, null)).resolves.toBeNull();
    await expect(prepareTripAttachment(createPostMedia({}), authorId, undefined)).resolves.toBeUndefined();
  });
});

describe('PostImagesResolver: poster lộ trình (TF105)', () => {
  it('gắn posterUrl cho cả reel, ảnh không còn thì bỏ qua để dùng poster video', async () => {
    const resolver = new PostImagesResolver(
      createPostMedia({}, { [posterId]: { url: 'https://cdn.example/poster.jpg', widthPx: 1080, heightPx: 1350 } }),
    );
    const [withPoster, missing, none] = await resolver.attach([
      { postType: 'video', mediaIds: ['v1'], tripAttachment: { posterMediaId: posterId } },
      { postType: 'video', mediaIds: ['v2'], tripAttachment: { posterMediaId: 'gone' } },
      { postType: 'video', mediaIds: ['v3'], tripAttachment: null },
    ]);
    expect(withPoster!.tripAttachment).toEqual({ posterMediaId: posterId, posterUrl: 'https://cdn.example/poster.jpg' });
    expect(withPoster!.images).toEqual([]);
    expect(missing!.tripAttachment).toEqual({ posterMediaId: 'gone' });
    expect(none!.tripAttachment).toBeNull();
  });
});
