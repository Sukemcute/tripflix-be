import { describe, expect, it } from 'vitest';
import {
  assertMediaAllowedForPostType,
  assertMediaKindsForPostType,
  Comment,
  MAX_VLOG_IMAGES,
  InvalidPostStatusTransitionException,
  InvalidReactionTypeException,
  Post,
  PostMediaNotAllowedException,
  PostPublishValidationException,
  Reaction,
  UnauthorizedCommentActionException,
  UnauthorizedPostActionException,
  type PostProps,
} from './index.js';

describe('Post Entity Domain Rules', () => {
  const authorId = '018d9f00-user-7000-8000-000000000001';
  const otherUserId = '018d9f00-user-7000-8000-000000000002';
  const postId = '018d9f20-post-7000-8000-000000000001';

  function createTestPost(overrides: Partial<PostProps> = {}) {
    return new Post({
      id: postId,
      authorId,
      postType: 'video',
      title: 'Khám phá Phú Quốc',
      body: 'Review chi tiết chuyến đi...',
      hashtags: ['phuquoc'],
      status: 'draft',
      visibility: 'public',
      isVerified: false,
      mediaIds: ['018d9f10-1234-7000-8000-000000000001'],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  }

  it('xác định đúng quyền sở hữu bài đăng', () => {
    const post = createTestPost();
    expect(post.isOwnedBy(authorId)).toBe(true);
    expect(post.isOwnedBy(otherUserId)).toBe(false);
  });

  it('bản nháp chỉ tác giả hoặc staff mới xem được', () => {
    const draftPost = createTestPost({ status: 'draft' });
    expect(draftPost.canBeViewedBy(authorId)).toBe(true);
    expect(draftPost.canBeViewedBy(otherUserId)).toBe(false);
    expect(draftPost.canBeViewedBy(undefined)).toBe(false);
    expect(draftPost.canBeViewedBy(otherUserId, true)).toBe(true); // staff
  });

  it('bài đăng private chỉ tác giả hoặc staff mới xem được', () => {
    const privatePost = createTestPost({ status: 'published', visibility: 'private' });
    expect(privatePost.canBeViewedBy(authorId)).toBe(true);
    expect(privatePost.canBeViewedBy(otherUserId)).toBe(false);
    expect(privatePost.canBeViewedBy(undefined)).toBe(false);
    expect(privatePost.canBeViewedBy(otherUserId, true)).toBe(true);
  });

  it('bài đăng public published thì ai cũng xem được', () => {
    const publicPost = createTestPost({ status: 'published', visibility: 'public' });
    expect(publicPost.canBeViewedBy(authorId)).toBe(true);
    expect(publicPost.canBeViewedBy(otherUserId)).toBe(true);
    expect(publicPost.canBeViewedBy(undefined)).toBe(true);
  });

  it('bài đăng bị xóa hoặc ẩn không cho người dùng thường xem', () => {
    const deletedPost = createTestPost({ status: 'deleted' });
    expect(deletedPost.canBeViewedBy(authorId)).toBe(false);
    expect(deletedPost.canBeViewedBy(otherUserId)).toBe(false);
    expect(deletedPost.canBeViewedBy(authorId, true)).toBe(true); // staff xem được
  });

  it('bài đang giữ chờ kiểm duyệt chỉ tác giả hoặc staff xem được (TF90)', () => {
    const heldPost = createTestPost({ status: 'held', publishedAt: new Date() });
    expect(heldPost.canBeViewedBy(authorId)).toBe(true);
    expect(heldPost.canBeViewedBy(otherUserId)).toBe(false);
    expect(heldPost.canBeViewedBy(undefined)).toBe(false);
    expect(heldPost.canBeViewedBy(otherUserId, true)).toBe(true);
  });

  it('tác giả vẫn sửa được bài đang giữ', () => {
    const heldPost = createTestPost({ status: 'held' });
    heldPost.update(authorId, { body: 'Bản sửa' });
    expect(heldPost.body).toBe('Bản sửa');
    expect(heldPost.status).toBe('held');
  });

  it('xuất bản bài đăng thành công khi thoả mãn điều kiện', () => {
    const draft = createTestPost();
    draft.publish(authorId, { isVerified: true });
    expect(draft.status).toBe('published');
    expect(draft.isVerified).toBe(true);
    expect(draft.publishedAt).toBeInstanceOf(Date);
  });

  it('không cho người khác xuất bản bài của mình', () => {
    const draft = createTestPost();
    expect(() => draft.publish(otherUserId, { isVerified: false })).toThrow(UnauthorizedPostActionException);
  });

  it('không thể xuất bản bài không ở trạng thái draft', () => {
    const published = createTestPost({ status: 'published' });
    expect(() => published.publish(authorId, { isVerified: false })).toThrow(InvalidPostStatusTransitionException);
  });

  it('không thể xuất bản bài khi không có cả media lẫn nội dung chữ', () => {
    const emptyDraft = createTestPost({ mediaIds: [], body: '' });
    expect(() => emptyDraft.publish(authorId, { isVerified: false })).toThrow(PostPublishValidationException);
  });

  it(`bài viết (vlog) gắn quá ${MAX_VLOG_IMAGES} ảnh khi chỉnh sửa thì bị chặn, giữ nguyên ảnh cũ`, () => {
    const vlog = createTestPost({ postType: 'vlog', mediaIds: [] });
    const tooMany = Array.from({ length: MAX_VLOG_IMAGES + 1 }, (_, index) => `image-${index}`);
    expect(() => vlog.update(authorId, { mediaIds: tooMany })).toThrow(PostMediaNotAllowedException);
    expect(vlog.mediaIds).toEqual([]);
  });

  it('vlog chỉ có ảnh, không có chữ vẫn xuất bản được', () => {
    const vlog = createTestPost({ postType: 'vlog', mediaIds: ['image-1'], body: '' });
    vlog.publish(authorId, { isVerified: false });
    expect(vlog.status).toBe('published');
  });

  it('vlog chỉ có chữ xuất bản bình thường', () => {
    const vlog = createTestPost({ postType: 'vlog', mediaIds: [] });
    vlog.publish(authorId, { isVerified: false });
    expect(vlog.status).toBe('published');
  });

  it('Reels không có video thì không xuất bản được', () => {
    const reel = createTestPost({ postType: 'video', mediaIds: [] });
    expect(() => reel.publish(authorId, { isVerified: false })).toThrow(PostPublishValidationException);
  });

  it('assertMediaAllowedForPostType chặn trùng id và vlog quá số ảnh', () => {
    expect(() => assertMediaAllowedForPostType('vlog', ['m1', 'm1'])).toThrow(PostMediaNotAllowedException);
    expect(() =>
      assertMediaAllowedForPostType('vlog', Array.from({ length: MAX_VLOG_IMAGES + 1 }, (_, index) => `m${index}`)),
    ).toThrow(PostMediaNotAllowedException);
    expect(() => assertMediaAllowedForPostType('vlog', ['m1', 'm2'])).not.toThrow();
    expect(() => assertMediaAllowedForPostType('video', ['m1'])).not.toThrow();
  });

  describe('assertMediaKindsForPostType', () => {
    const readyImage = { kind: 'image', ownerId: authorId, status: 'ready' } as const;
    const kinds = (entries: Array<[string, { kind: 'video' | 'image'; ownerId: string; status: 'uploading' | 'ready' }]>) =>
      new Map(entries);

    it('vlog kèm ảnh của chính tác giả đã tải xong thì được', () => {
      expect(() =>
        assertMediaKindsForPostType('vlog', authorId, ['i1', 'i2'], kinds([['i1', readyImage], ['i2', readyImage]])),
      ).not.toThrow();
    });

    it('vlog kèm video (kể cả bản nháp cũ) thì bị chặn: video phải đăng dạng Reels', () => {
      expect(() =>
        assertMediaKindsForPostType('vlog', authorId, ['v1'], kinds([['v1', { ...readyImage, kind: 'video' }]])),
      ).toThrow('không được kèm video');
    });

    it('vlog kèm ảnh của người khác, ảnh chưa tải xong hay id lạ thì bị chặn', () => {
      expect(() =>
        assertMediaKindsForPostType('vlog', authorId, ['i1'], kinds([['i1', { ...readyImage, ownerId: 'other-user' }]])),
      ).toThrow(PostMediaNotAllowedException);
      expect(() =>
        assertMediaKindsForPostType('vlog', authorId, ['i1'], kinds([['i1', { ...readyImage, status: 'uploading' }]])),
      ).toThrow(PostMediaNotAllowedException);
      expect(() => assertMediaKindsForPostType('vlog', authorId, ['unknown'], kinds([]))).toThrow(
        PostMediaNotAllowedException,
      );
    });

    it('Reels kèm ảnh thì bị chặn; id video không tìm thấy vẫn cho qua như trước', () => {
      expect(() => assertMediaKindsForPostType('video', authorId, ['i1'], kinds([['i1', readyImage]]))).toThrow(
        'Reels chỉ kèm video',
      );
      expect(() => assertMediaKindsForPostType('video', authorId, ['seed-video'], kinds([]))).not.toThrow();
    });
  });

  it('chỉnh sửa bài đăng cập nhật đúng dữ liệu', () => {
    const post = createTestPost();
    post.update(authorId, { title: 'Tiêu đề mới', visibility: 'private' });
    expect(post.title).toBe('Tiêu đề mới');
    expect(post.visibility).toBe('private');
  });

  it('chặn người khác chỉnh sửa bài đăng', () => {
    const post = createTestPost();
    expect(() => post.update(otherUserId, { title: 'Hacked' })).toThrow(UnauthorizedPostActionException);
  });

  it('xóa mềm bài đăng chuyển status thành deleted', () => {
    const post = createTestPost({ status: 'published' });
    post.softDelete(authorId);
    expect(post.status).toBe('deleted');
    expect(post.deletedAt).toBeInstanceOf(Date);
  });

  it('thao tác kiểm duyệt moderate ẩn và khôi phục bài viết đúng trạng thái', () => {
    // Bài đã xuất bản
    const publishedPost = createTestPost({ status: 'published', publishedAt: new Date() });
    publishedPost.moderate('hide');
    expect(publishedPost.status).toBe('hidden');
    publishedPost.moderate('restore');
    expect(publishedPost.status).toBe('published');

    // Bài nháp chưa từng xuất bản
    const draftPost = createTestPost({ status: 'draft', publishedAt: null });
    draftPost.moderate('hide');
    expect(draftPost.status).toBe('hidden');
    draftPost.moderate('restore');
    expect(draftPost.status).toBe('draft');
  });

  it('tự động hạ cờ isVerified về false khi tác giả sửa lộ trình', () => {
    const verifiedPost = createTestPost({ status: 'published', isVerified: true });
    expect(verifiedPost.isVerified).toBe(true);
    verifiedPost.update(authorId, {
      tripAttachment: { destinationName: 'Địa điểm mới', hotelName: 'Khách sạn mới' },
    });
    expect(verifiedPost.isVerified).toBe(false);
  });

  it('lộ trình du lịch trả về luôn bị ẩn PII và có disclaimer giá', () => {
    const post = createTestPost({
      tripAttachment: {
        bookingId: 'booking-secret-123',
        hotelName: 'Vinpearl Phú Quốc',
        hotelId: 'hotel-001',
        destinationName: 'Phú Quốc',
        daysCount: 3,
        estimatedCostPerPerson: 3500000,
        items: [
          { day: 1, title: 'Bay từ Sài Gòn', transport: { mode: 'flight', fromAirport: 'SGN', toAirport: 'PQC' } },
          { day: 2, title: 'Check in' },
        ],
      },
    });

    const masked = post.getMaskedTripAttachment();
    expect(masked).toBeDefined();
    expect(masked?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
    expect((masked as any).bookingId).toBeUndefined(); // Không chứa bookingId
    expect(masked?.hotelName).toBe('Vinpearl Phú Quốc');
    expect(masked?.items?.[0]?.transport).toEqual({ mode: 'flight', fromAirport: 'SGN', toAirport: 'PQC' });
    expect(masked?.items?.[1]?.transport).toBeUndefined();
  });
});

describe('Comment Entity Domain Rules', () => {
  const authorId = '018d9f00-user-7000-8000-000000000001';
  const otherUserId = '018d9f00-user-7000-8000-000000000002';

  it('sửa bình luận thành công và đánh dấu isEdited', () => {
    const comment = new Comment({
      id: 'comm-1',
      postId: 'post-1',
      authorId,
      body: 'Bình luận ban đầu',
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    comment.updateBody(authorId, 'Bình luận đã sửa');
    expect(comment.body).toBe('Bình luận đã sửa');
    expect(comment.isEdited).toBe(true);
  });

  it('chặn người khác sửa bình luận của mình', () => {
    const comment = new Comment({
      id: 'comm-1',
      postId: 'post-1',
      authorId,
      body: 'Bình luận ban đầu',
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(() => comment.updateBody(otherUserId, 'Nội dung khác')).toThrow(UnauthorizedCommentActionException);
  });

  it('chặn reply của reply (chỉ cho phép 1 cấp reply)', () => {
    // Bình luận gốc (parentCommentId: null) -> cho phép reply
    expect(() => Comment.validateParentForReply({ parentCommentId: null })).not.toThrow();

    // Bình luận đã là reply (parentCommentId có giá trị) -> chặn không cho reply tiếp
    expect(() => Comment.validateParentForReply({ parentCommentId: 'parent-001' })).toThrow(
      /Chỉ hỗ trợ phản hồi bình luận 1 cấp/,
    );
  });
});

describe('Reaction Entity Domain Rules', () => {
  it('khởi tạo thành công với type hợp lệ', () => {
    const reaction = new Reaction({
      id: 'react-1',
      postId: 'post-1',
      userId: 'user-1',
      type: 'like',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(reaction.type).toBe('like');
    reaction.changeType('love');
    expect(reaction.type).toBe('love');
  });

  it('báo lỗi khi truyền type không hợp lệ', () => {
    expect(() => {
      new Reaction({
        id: 'react-1',
        postId: 'post-1',
        userId: 'user-1',
        type: 'invalid' as any,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }).toThrow(InvalidReactionTypeException);
  });
});
