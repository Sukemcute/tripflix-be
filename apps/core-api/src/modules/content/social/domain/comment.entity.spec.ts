import { describe, expect, it } from 'vitest';
import {
  Comment,
  InvalidCommentBodyException,
  InvalidCommentNestingException,
  UnauthorizedCommentActionException,
} from './index.js';

describe('Comment Domain Entity', () => {
  const baseProps = {
    id: '018d9f40-0000-7000-8000-000000000001',
    postId: '018d9f20-0000-7000-8000-000000000001',
    authorId: '018d9f00-0000-7000-8000-000000000001',
    body: 'Bình luận ban đầu',
    isEdited: false,
    createdAt: new Date('2026-11-05T00:00:00Z'),
    updatedAt: new Date('2026-11-05T00:00:00Z'),
  };

  describe('validateBody', () => {
    it('ném lỗi nếu nội dung rỗng hoặc chỉ có khoảng trắng', () => {
      expect(() => Comment.validateBody('')).toThrow(InvalidCommentBodyException);
      expect(() => Comment.validateBody('   ')).toThrow(InvalidCommentBodyException);
      expect(() => Comment.validateBody(null as unknown as string)).toThrow(InvalidCommentBodyException);
    });

    it('ném lỗi nếu nội dung vượt quá 2.000 ký tự', () => {
      const longBody = 'A'.repeat(2_001);
      expect(() => Comment.validateBody(longBody)).toThrow(InvalidCommentBodyException);
    });

    it('hợp lệ và tự động trim khi nội dung đúng quy chuẩn (1 - 2.000 ký tự)', () => {
      const validBody = '  Trải nghiệm rất tuyệt vời!  ';
      expect(Comment.validateBody(validBody)).toBe('Trải nghiệm rất tuyệt vời!');

      const maxBody = 'B'.repeat(2_000);
      expect(Comment.validateBody(maxBody)).toBe(maxBody);
    });
  });

  describe('validateParentForReply', () => {
    it('cho phép phản hồi bình luận gốc (parentCommentId là null hoặc undefined)', () => {
      expect(() => Comment.validateParentForReply({ parentCommentId: null })).not.toThrow();
      expect(() => Comment.validateParentForReply({})).not.toThrow();
    });

    it('ném InvalidCommentNestingException khi phản hồi một phản hồi con (chỉ cho phép lồng 1 cấp)', () => {
      expect(() => Comment.validateParentForReply({ parentCommentId: 'parent-123' })).toThrow(
        InvalidCommentNestingException,
      );
    });
  });

  describe('updateBody', () => {
    it('cho phép tác giả cập nhật nội dung bình luận', () => {
      const comment = new Comment({ ...baseProps });
      comment.updateBody('018d9f00-0000-7000-8000-000000000001', 'Nội dung cập nhật mới');

      expect(comment.body).toBe('Nội dung cập nhật mới');
      expect(comment.isEdited).toBe(true);
    });

    it('từ chối người khác cập nhật bình luận', () => {
      const comment = new Comment({ ...baseProps });
      expect(() => comment.updateBody('stranger-user', 'Spam')).toThrow(
        UnauthorizedCommentActionException,
      );
    });

    it('ném lỗi khi cập nhật nội dung vượt quá 2.000 ký tự', () => {
      const comment = new Comment({ ...baseProps });
      const tooLong = 'C'.repeat(2_001);
      expect(() => comment.updateBody('018d9f00-0000-7000-8000-000000000001', tooLong)).toThrow(
        'Nội dung bình luận không được vượt quá 2,000 ký tự',
      );
    });
  });

  describe('softDelete', () => {
    it('cho phép tác giả hoặc superadmin xóa bình luận', () => {
      const comment1 = new Comment({ ...baseProps });
      comment1.softDelete('018d9f00-0000-7000-8000-000000000001');
      expect(comment1.deletedAt).toBeDefined();

      const comment2 = new Comment({ ...baseProps });
      comment2.softDelete('admin-id', true);
      expect(comment2.deletedAt).toBeDefined();
    });

    it('từ chối người dùng khác xóa bình luận', () => {
      const comment = new Comment({ ...baseProps });
      expect(() => comment.softDelete('stranger-user', false)).toThrow(
        UnauthorizedCommentActionException,
      );
    });
  });
});
