import { describe, expect, it } from 'vitest';
import {
  Comment,
  InvalidPostStatusTransitionException,
  InvalidReactionTypeException,
  Post,
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

  it('thao tác kiểm duyệt moderate ẩn và khôi phục bài viết', () => {
    const post = createTestPost({ status: 'published' });
    post.moderate('hide');
    expect(post.status).toBe('hidden');
    post.moderate('restore');
    expect(post.status).toBe('published');
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
        items: [{ day: 1, title: 'Check in' }],
      },
    });

    const masked = post.getMaskedTripAttachment();
    expect(masked).toBeDefined();
    expect(masked?.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
    expect((masked as any).bookingId).toBeUndefined(); // Không chứa bookingId
    expect(masked?.hotelName).toBe('Vinpearl Phú Quốc');
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
