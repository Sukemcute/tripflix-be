import { describe, expect, it } from 'vitest';
import { Comment, InvalidCommentMentionsException } from './index.js';

const userId = '018d9f00-0000-7000-8000-000000000001';
const otherId = '018d9f00-0000-7000-8000-000000000002';
const mention = { userId, offset: 0, length: 3 };

describe('TF25: tag trong Comment', () => {
  it('dùng offset UTF-16 sau emoji, giữ Unicode và sắp theo vị trí', () => {
    const mentions = [
      { userId: otherId, offset: 7, length: 3 },
      { ...mention, offset: 3 },
    ];
    expect(Comment.validateMentions('😀 @An @Bé', mentions)).toEqual([mentions[1], mentions[0]]);
  });

  it('điều chỉnh offset khi trim khoảng trắng đầu body', () => {
    expect(Comment.prepareContent('  @An xin chào  ', [{ ...mention, offset: 2 }])).toEqual({
      body: '@An xin chào',
      mentions: [mention],
    });
  });

  it('không tự suy ra tag từ chữ @ trong body', () => {
    expect(Comment.prepareContent('@An')).toEqual({ body: '@An', mentions: [] });
  });

  it.each([
    null,
    {},
    [null],
    [{ ...mention, userId: 'not-a-uuid' }],
    [{ ...mention, offset: -1 }],
    [{ ...mention, offset: 0.5 }],
    [{ ...mention, offset: '0' }],
    [{ ...mention, length: 1 }],
    [{ ...mention, length: 3.1 }],
    [{ ...mention, length: 4 }],
    [{ ...mention, offset: Number.MAX_SAFE_INTEGER + 1 }],
  ])('từ chối cấu trúc hoặc khoảng không hợp lệ: %j', (input) => {
    expect(() => Comment.validateMentions('@An', input)).toThrow(InvalidCommentMentionsException);
  });

  it('bắt đầu bằng @ và có tên sau @', () => {
    expect(() => Comment.validateMentions(' An', [mention])).toThrow(InvalidCommentMentionsException);
    expect(() => Comment.validateMentions('@  ', [mention])).toThrow(InvalidCommentMentionsException);
  });

  it('từ chối khoảng trùng hoặc chồng nhau', () => {
    expect(() => Comment.validateMentions('@An', [mention, { ...mention, userId: otherId }])).toThrow(
      InvalidCommentMentionsException,
    );
    expect(() =>
      Comment.validateMentions('@A@B', [mention, { userId: otherId, offset: 2, length: 2 }]),
    ).toThrow(InvalidCommentMentionsException);
  });

  it('cho phép khoảng liền nhau nhưng không cho trùng userId', () => {
    expect(
      Comment.validateMentions('@An@Bé', [mention, { userId: otherId, offset: 3, length: 3 }]),
    ).toHaveLength(2);
    expect(() => Comment.validateMentions('@An @An', [mention, { ...mention, offset: 4 }])).toThrow(
      InvalidCommentMentionsException,
    );
  });

  it('không cho dùng chữ hoa UUID để né kiểm tra trùng', () => {
    const id = '018d9fab-0000-7000-8000-000000000001';
    expect(() =>
      Comment.validateMentions('@An @An', [
        { ...mention, userId: id },
        { ...mention, userId: id.toUpperCase(), offset: 4 },
      ]),
    ).toThrow(InvalidCommentMentionsException);
  });

  it('không cắt đôi surrogate pair ở cuối tag', () => {
    expect(() => Comment.validateMentions('@😀', [{ ...mention, length: 2 }])).toThrow(
      InvalidCommentMentionsException,
    );
    expect(Comment.validateMentions('@😀', [mention])).toEqual([mention]);
  });

  it('cho phép tối đa 10 người, từ chối 11', () => {
    const body = Array.from({ length: 11 }, () => '@A').join(' ');
    const mentions = Array.from({ length: 11 }, (_, index) => ({
      userId: `018d9f00-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
      offset: index * 3,
      length: 2,
    }));
    expect(Comment.validateMentions(body, mentions.slice(0, 10))).toHaveLength(10);
    expect(() => Comment.validateMentions(body, mentions)).toThrow(InvalidCommentMentionsException);
  });

  function createComment() {
    return new Comment({
      id: 'comment',
      postId: 'post',
      authorId: 'author',
      body: '@An xin chào',
      mentions: [mention],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('edit thiếu mentions giữ tag; tag không khớp body mới thì không ghi gì', () => {
    const comment = createComment();
    comment.updateBody('author', '@An rất vui');
    expect(comment.mentions).toEqual([mention]);
    expect(() => comment.updateBody('author', 'Xin chào')).toThrow(InvalidCommentMentionsException);
    expect(comment.body).toBe('@An rất vui');
    expect(comment.mentions).toEqual([mention]);
  });

  it('edit truyền [] để bỏ tag và có thể thay tag với body mới', () => {
    const comment = createComment();
    comment.updateBody('author', 'Xin chào', []);
    expect(comment.mentions).toEqual([]);
    comment.updateBody('author', '😀 @Bé', [{ userId: otherId, offset: 3, length: 3 }]);
    expect(comment.mentions).toEqual([{ userId: otherId, offset: 3, length: 3 }]);
  });

  it('không làm thay đổi tag qua tham chiếu props/getter/toRaw', () => {
    const props = createComment().toRaw();
    const comment = new Comment(props);
    props.mentions![0]!.offset = 99;
    comment.mentions[0]!.offset = 99;
    comment.toRaw().mentions![0]!.offset = 99;
    expect(comment.mentions).toEqual([mention]);
  });
});
