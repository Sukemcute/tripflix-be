import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import type { PostRecord } from '../../../db/schema/index.js';
import { PostMediaNotAllowedException, type PostMediaInfo } from '../../domain/index.js';
import { PostImagesResolver } from '../common/post-images.js';
import { PostShareLinks } from '../post-share-links.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { PostImage, PostMediaPort } from '../ports/post-media.port.js';
import { CreateDraftUseCase } from './create-draft.use-case.js';
import { PublishPostUseCase } from './publish-post.use-case.js';
import { UpdatePostUseCase } from './update-post.use-case.js';

const authorId = '018d9f00-user-7000-8000-000000000001';
const postId = '018d9f20-post-7000-8000-000000000001';

function createPostMedia(
  mediaInfo: Record<string, PostMediaInfo>,
  images: Record<string, Omit<PostImage, 'id'>> = {},
): PostMediaPort & { getImages: ReturnType<typeof vi.fn> } {
  return {
    findMediaInfo: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (mediaInfo[id] ? [[id, mediaInfo[id]!]] : [])))),
    getImages: vi.fn(async (ids: string[]) =>
      new Map(ids.flatMap((id) => (images[id] ? [[id, { id, ...images[id]! }]] : []))),
    ),
  };
}

const readyImage: PostMediaInfo = { kind: 'image', ownerId: authorId, status: 'ready' };
const readyVideo: PostMediaInfo = { kind: 'video', ownerId: authorId, status: 'ready' };

function samplePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: postId,
    authorId,
    postType: 'vlog',
    title: 'Đà Lạt 3 ngày',
    body: 'Chia sẻ lịch trình',
    hashtags: [],
    status: 'draft',
    visibility: 'public',
    isVerified: false,
    mediaIds: [],
    coverMediaId: null,
    tripAttachment: null,
    reactionCounts: {},
    reactionTotal: 0,
    commentCount: 0,
    shareCount: 0,
    bookmarkCount: 0,
    publishedAt: null,
    createdAt: new Date('2026-11-13T08:00:00Z'),
    updatedAt: new Date('2026-11-13T08:00:00Z'),
    deletedAt: null,
    ...overrides,
  } as PostRecord;
}

describe('Ảnh của bài viết (vlog)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() })],
    }).compile();
    await moduleRef.init();
  });

  it('tạo bản nháp bài viết kèm ảnh của chính mình đã tải xong', async () => {
    const postRepository = { create: vi.fn(async (record) => samplePost(record)) };
    const useCase = new CreateDraftUseCase(postRepository as never, createPostMedia({ i1: readyImage, i2: readyImage }));

    const created = await useCase.execute({ authorId, postType: 'vlog', title: 'Đà Lạt', mediaIds: ['i1', 'i2'] });

    expect(created.mediaIds).toEqual(['i1', 'i2']);
  });

  it('tạo bản nháp bài viết kèm video thì bị chặn, không ghi gì', async () => {
    const postRepository = { create: vi.fn() };
    const useCase = new CreateDraftUseCase(postRepository as never, createPostMedia({ v1: readyVideo }));

    await expect(useCase.execute({ authorId, postType: 'vlog', title: 'Đà Lạt', mediaIds: ['v1'] })).rejects.toThrow(
      PostMediaNotAllowedException,
    );
    expect(postRepository.create).not.toHaveBeenCalled();
  });

  it('sửa bài viết gắn ảnh của người khác thì bị chặn', async () => {
    const postRepository = { findById: vi.fn(async () => samplePost()), update: vi.fn() };
    const useCase = new UpdatePostUseCase(
      postRepository as never,
      undefined,
      createPostMedia({ i1: { ...readyImage, ownerId: 'someone-else' } }),
    );

    await expect(useCase.execute({ postId, userId: authorId, mediaIds: ['i1'] })).rejects.toThrow(
      PostMediaNotAllowedException,
    );
    expect(postRepository.update).not.toHaveBeenCalled();
  });

  it('bản nháp bài viết cũ đã lỡ gắn video thì không xuất bản được', async () => {
    const postRepository = { findById: vi.fn(async () => samplePost({ mediaIds: ['v1'] })) };
    const addOutboxEvent = vi.fn();
    const outbox: ContentOutbox = { add: addOutboxEvent };
    const useCase = new PublishPostUseCase(
      postRepository as never,
      outbox,
      undefined,
      new PostShareLinks(),
      createPostMedia({ v1: readyVideo }),
    );

    await expect(useCase.execute({ postId, userId: authorId })).rejects.toThrow(PostMediaNotAllowedException);
    expect(addOutboxEvent).not.toHaveBeenCalled();
  });
});

describe('PostImagesResolver', () => {
  const image = (name: string) => ({ url: `https://cdn.test/${name}.jpg`, widthPx: 1080, heightPx: 1350 });

  it('gắn ảnh theo đúng thứ tự mediaIds, bỏ ảnh chưa xong, một lần hỏi cho cả trang', async () => {
    const postMedia = createPostMedia({}, { a: image('a'), b: image('b'), c: image('c') });
    const resolver = new PostImagesResolver(postMedia);

    const [first, second, reel] = await resolver.attach([
      { postType: 'vlog', mediaIds: ['b', 'missing', 'a'] },
      { postType: 'vlog', mediaIds: ['c'] },
      { postType: 'video', mediaIds: ['video-1'] },
    ]);

    expect(first!.images.map((item) => item.id)).toEqual(['b', 'a']);
    expect(second!.images[0]).toEqual({ id: 'c', ...image('c') });
    expect(reel!.images).toEqual([]);
    expect(postMedia.getImages).toHaveBeenCalledTimes(1);
    expect(postMedia.getImages).toHaveBeenCalledWith(['b', 'missing', 'a', 'c']);
  });

  it('trang không có bài viết nào kèm ảnh thì không hỏi module media', async () => {
    const postMedia = createPostMedia({});
    const page = await new PostImagesResolver(postMedia).attachToPage({
      items: [{ postType: 'vlog', mediaIds: [] }],
      nextCursor: 'next',
    });

    expect(page).toEqual({ items: [{ postType: 'vlog', mediaIds: [], images: [], video: null }], nextCursor: 'next' });
    expect(postMedia.getImages).not.toHaveBeenCalled();
  });

  it('gắn video playback cho bài video khi có getPlayback', async () => {
    const playbackInfo = {
      hlsUrl: 'https://cdn.test/master.m3u8',
      posters: { w360: 'https://cdn/360.jpg', w540: 'https://cdn/540.jpg', w720: 'https://cdn/720.jpg' },
      durationSec: 30,
      aspect: '9:16' as const,
      levels: [360, 720] as any[],
    };
    const postMedia = {
      ...createPostMedia({}),
      getPlayback: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, playbackInfo]))),
    };
    const [reel] = await new PostImagesResolver(postMedia).attach([
      { postType: 'video', mediaIds: ['v1'] },
    ]);
    expect(reel!.video).toEqual(playbackInfo);
    expect(reel!.images).toEqual([]);
    expect(postMedia.getPlayback).toHaveBeenCalledWith(['v1']);
  });
});
