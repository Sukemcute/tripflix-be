import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST_SIGNAL_WINDOW_MS, PostCommentSignals, toPostCommentChange } from './post-comment-signals.js';

const postId = randomUUID();
const authorId = randomUUID();
const now = '2026-11-16T09:00:00.000Z';

function event(type: string, payload: Record<string, unknown>): EventEnvelope {
  return { eventId: randomUUID(), type, version: 1, occurredAt: now, producer: 'core-api', payload };
}

function created(overrides: Record<string, unknown> = {}) {
  return event('content.comment.created', {
    commentId: randomUUID(), postId, postAuthorId: randomUUID(), authorId, parentCommentId: null,
    body: 'Bí mật', createdAt: now, postVisibility: 'public', ...overrides,
  });
}

describe('toPostCommentChange (TF99)', () => {
  it('chỉ phát cho bài public; private hoặc thiếu postVisibility thì không', () => {
    expect(toPostCommentChange(created())).not.toBeNull();
    expect(toPostCommentChange(created({ postVisibility: 'private' }))).toBeNull();
    expect(toPostCommentChange(created({ postVisibility: undefined }))).toBeNull();
    expect(toPostCommentChange(event('content.reaction.updated', { postId }))).toBeNull();
  });

  it('ánh xạ 5 loại sự kiện, không gửi nội dung, không lộ kiểm duyệt viên', () => {
    const commentId = randomUUID();
    const parentCommentId = randomUUID();
    const deletedBy = randomUUID();
    const base = { commentId, postId, authorId, postVisibility: 'public' };
    const cases = [
      [created({ commentId, parentCommentId }), { kind: 'created', actorId: authorId, parentCommentId }],
      [event('content.comment.updated', { ...base, parentCommentId, body: 'Sửa', updatedAt: now }),
        { kind: 'updated', actorId: authorId, parentCommentId }],
      [event('content.comment.deleted', { ...base, parentCommentId, deletedBy, isSuperAdmin: true, deletedAt: now }),
        { kind: 'deleted', actorId: deletedBy, parentCommentId }],
      [event('content.comment.hidden', base), { kind: 'hidden', actorId: null, parentCommentId: null }],
      [event('content.comment.restored', { ...base, parentCommentId, body: 'Hiện lại' }),
        { kind: 'restored', actorId: null, parentCommentId }],
    ] as const;
    for (const [input, expected] of cases) {
      expect(toPostCommentChange(input)).toEqual({ postId, commentId, ...expected });
    }
  });
});

describe('PostCommentSignals gom lô 250 ms', () => {
  const emit = vi.fn();
  const onError = vi.fn();
  let signals: PostCommentSignals;

  beforeEach(() => {
    vi.useFakeTimers();
    emit.mockReset();
    onError.mockReset();
    signals = new PostCommentSignals(emit, onError);
  });

  afterEach(() => {
    signals.stop();
    vi.useRealTimers();
  });

  it('bài ít bình luận (≤ 4/giây) phát ngay từng cái', () => {
    signals.handle(created());
    vi.advanceTimersByTime(POST_SIGNAL_WINDOW_MS);
    signals.handle(created());
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(postId, expect.objectContaining({ kind: 'created', changeCount: 1 }));
  });

  it('bài nóng: phát ngay cái đầu, gom phần còn lại thành một tín hiệu mỗi 250 ms', () => {
    const changes = Array.from({ length: 6 }, () => created());
    changes.slice(0, 4).forEach((change) => signals.handle(change));
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POST_SIGNAL_WINDOW_MS);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(postId, expect.objectContaining({
      commentId: (changes[3]!.payload as { commentId: string }).commentId, changeCount: 3,
    }));
    changes.slice(4).forEach((change) => signals.handle(change));
    expect(emit).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(POST_SIGNAL_WINDOW_MS);
    expect(emit).toHaveBeenLastCalledWith(postId, expect.objectContaining({ changeCount: 2 }));
    vi.advanceTimersByTime(POST_SIGNAL_WINDOW_MS * 4);
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('mỗi bài gom riêng', () => {
    signals.handle(created());
    signals.handle(created({ postId: randomUUID() }));
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('payload hỏng chỉ ghi log, phát lỗi không ném ra ngoài', () => {
    expect(() => signals.handle(event('content.comment.created', { postId }))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    emit.mockImplementation(() => { throw new Error('Socket.IO lỗi'); });
    expect(() => signals.handle(created())).not.toThrow();
  });
});
