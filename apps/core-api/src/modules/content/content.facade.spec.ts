import { describe, expect, it, vi } from 'vitest';
import { ContentFacade } from './content.facade.js';
import type { PostRecord } from './db/schema/index.js';

describe('ContentFacade', () => {
  const createMockPost = (overrides: Partial<PostRecord> = {}): PostRecord => ({
    id: '018d9f20-post-7000-8000-000000000001',
    authorId: '018d9f00-user-7000-8000-000000000001',
    postType: 'vlog',
    title: 'Khám phá Đà Nẵng',
    body: 'Lịch trình 3 ngày 2 đêm',
    hashtags: ['danang', 'travel'],
    status: 'published',
    visibility: 'public',
    isVerified: true,
    mediaIds: ['018d9f10-med-7000-8000-000000000001'],
    coverMediaId: null,
    tripAttachment: {
      bookingId: '018d9f30-book-7000-8000-000000000001',
      hotelId: 'h-123',
      hotelName: 'Grand Tourane Hotel',
      destinationName: 'Đà Nẵng',
      daysCount: 3,
      estimatedCostPerPerson: 2500000,
      items: [{ day: 1, title: 'Check in & Biển Mỹ Khê', location: 'Biển Mỹ Khê' }],
    },
    reactionCounts: { like: 10 },
    reactionTotal: 10,
    commentCount: 2,
    shareCount: 1,
    bookmarkCount: 4,
    createdAt: new Date('2026-11-04T08:00:00.000Z'),
    updatedAt: new Date('2026-11-04T08:00:00.000Z'),
    publishedAt: new Date('2026-11-04T08:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  });

  const mockPostRepo = {
    findById: vi.fn(),
    findByIds: vi.fn(),
    findPostsForSync: vi.fn(),
  };

  const facade = new ContentFacade(mockPostRepo as any);

  describe('getPostById', () => {
    it('trả về bài viết an toàn đã mask PII khi tồn tại và published', async () => {
      const mock = createMockPost({ status: 'published', deletedAt: null });
      mockPostRepo.findById.mockResolvedValueOnce(mock);

      const res = await facade.getPostById(mock.id);
      expect(res).not.toBeNull();
      expect(res?.id).toBe(mock.id);
      expect(res?.tripAttachment?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      expect((res?.tripAttachment as any)?.bookingId).toBeUndefined();
      expect(mockPostRepo.findById).toHaveBeenCalledWith(mock.id);
    });

    it('trả về null khi bài viết không tồn tại, ở trạng thái draft/hidden hoặc đã xóa', async () => {
      mockPostRepo.findById.mockResolvedValueOnce(null);
      expect(await facade.getPostById('non-existent')).toBeNull();

      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'draft' }));
      expect(await facade.getPostById('p1')).toBeNull();

      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'published', deletedAt: new Date() }));
      expect(await facade.getPostById('p1')).toBeNull();
    });
  });

  describe('isPostPublished', () => {
    it('trả về true khi bài ở trạng thái published và chưa xóa', async () => {
      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'published', deletedAt: null }));

      const res = await facade.isPostPublished('p1');
      expect(res).toBe(true);
    });

    it('trả về false khi bài ở trạng thái draft/hidden/removed hoặc đã bị xóa', async () => {
      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'draft' }));
      expect(await facade.isPostPublished('p1')).toBe(false);

      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'hidden' }));
      expect(await facade.isPostPublished('p1')).toBe(false);

      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'published', deletedAt: new Date() }));
      expect(await facade.isPostPublished('p1')).toBe(false);
    });
  });

  describe('getVisiblePosts', () => {
    it('trả về mảng rỗng khi input ids rỗng', async () => {
      const res = await facade.getVisiblePosts([]);
      expect(res).toEqual([]);
      expect(mockPostRepo.findByIds).not.toHaveBeenCalled();
    });

    it('chỉ trả về bài viết public + published và che PII thông tin nhạy cảm', async () => {
      const post1 = createMockPost({ id: 'p1', status: 'published', visibility: 'public' });
      const postDraft = createMockPost({ id: 'p2', status: 'draft', visibility: 'public' });
      const postPrivate = createMockPost({ id: 'p3', status: 'published', visibility: 'private' });
      const postDeleted = createMockPost({ id: 'p4', status: 'published', visibility: 'public', deletedAt: new Date() });

      mockPostRepo.findByIds.mockResolvedValueOnce([post1, postDraft, postPrivate, postDeleted]);

      const res = await facade.getVisiblePosts(['p1', 'p2', 'p3', 'p4']);
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe('p1');

      // Kiểm tra PII Masking: bookingId riêng tư phải bị loại bỏ, bổ sung disclaimer
      expect(res[0]?.tripAttachment?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      expect((res[0]?.tripAttachment as any)?.bookingId).toBeUndefined();
      expect(res[0]?.tripAttachment?.hotelName).toBe('Grand Tourane Hotel');
    });
  });

  describe('getPostStats', () => {
    it('trả về số liệu thống kê tương tác cho bài viết hợp lệ', async () => {
      const mock = createMockPost({
        reactionTotal: 15,
        reactionCounts: { like: 10, love: 5 },
        commentCount: 8,
        shareCount: 3,
        bookmarkCount: 2,
      });
      mockPostRepo.findById.mockResolvedValueOnce(mock);

      const res = await facade.getPostStats(mock.id);
      expect(res).toEqual({
        postId: mock.id,
        reactionTotal: 15,
        reactionCounts: { like: 10, love: 5 },
        commentCount: 8,
        shareCount: 3,
        bookmarkCount: 2,
      });
    });

    it('trả về null nếu bài viết không tồn tại hoặc đã xóa mềm', async () => {
      mockPostRepo.findById.mockResolvedValueOnce(null);
      expect(await facade.getPostStats('non-existent')).toBeNull();

      mockPostRepo.findById.mockResolvedValueOnce(createMockPost({ status: 'deleted' }));
      expect(await facade.getPostStats('deleted-post')).toBeNull();
    });
  });

  describe('listPosts', () => {
    it('lấy danh sách bài đăng phục vụ đồng bộ chỉ mục (Sync/Discovery) và che PII', async () => {
      const p1 = createMockPost({ id: 'p1', updatedAt: new Date('2026-11-04T10:00:00Z') });
      const p2 = createMockPost({ id: 'p2', updatedAt: new Date('2026-11-04T11:00:00Z') });

      mockPostRepo.findPostsForSync.mockResolvedValueOnce([p1, p2]);

      const res = await facade.listPosts({ limit: 10 });
      expect(res.items.length).toBe(2);
      expect(res.items[0]?.id).toBe('p1');
      expect((res.items[0]?.tripAttachment as any)?.bookingId).toBeUndefined();
      expect(res.items[0]?.tripAttachment?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      expect(res.nextCursor).toBeNull();
      expect(mockPostRepo.findPostsForSync).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 11 }),
      );
    });

    it('tạo nextCursor khi số lượng vượt limit và giải mã cursor trang tiếp theo', async () => {
      const p1 = createMockPost({ id: 'p1', updatedAt: new Date('2026-11-04T10:00:00Z') });
      const p2 = createMockPost({ id: 'p2', updatedAt: new Date('2026-11-04T11:00:00Z') });
      const p3 = createMockPost({ id: 'p3', updatedAt: new Date('2026-11-04T12:00:00Z') });

      // Gọi với limit = 2, repo trả 3 phần tử (limit + 1)
      mockPostRepo.findPostsForSync.mockResolvedValueOnce([p1, p2, p3]);

      const res = await facade.listPosts({ limit: 2, updatedAfter: '2026-11-04T00:00:00Z' });
      expect(res.items.length).toBe(2);
      expect(res.items.map((i) => i.id)).toEqual(['p1', 'p2']);
      expect(res.nextCursor).toBeTruthy();

      // Kiểm tra gọi tiếp với nextCursor
      mockPostRepo.findPostsForSync.mockResolvedValueOnce([p3]);
      const nextRes = await facade.listPosts({ limit: 2, cursor: res.nextCursor });
      expect(nextRes.items.length).toBe(1);
      expect(nextRes.items[0]?.id).toBe('p3');
      expect(nextRes.nextCursor).toBeNull();
      expect(mockPostRepo.findPostsForSync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cursorUpdatedAt: new Date('2026-11-04T11:00:00Z'),
          cursorId: 'p2',
        }),
      );
    });
  });
});
