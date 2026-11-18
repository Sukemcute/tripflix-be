import type { EventEnvelope } from '@tripflix/contracts';
import { describe, expect, it } from 'vitest';
import { retentionCutoff, toUserActivityRecord, USER_ACTIVITY_RETENTION_DAYS } from './user-activity.js';

const user = '11111111-1111-4111-8111-111111111111';
const post = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';

function envelope(type: string, payload: Record<string, unknown>, extra: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: '44444444-4444-4444-8444-444444444444',
    type,
    version: 1,
    occurredAt: '2026-11-17T10:00:00.000Z',
    producer: 'test',
    payload,
    ...extra,
  };
}

describe('toUserActivityRecord', () => {
  it('đếm lượt thích khi người dùng đặt thích, bỏ khi bỏ thích', () => {
    const like = toUserActivityRecord(
      envelope('content.reaction.updated', { postId: post, userId: user, type: 'like', reactionTotal: 1, reactionCounts: {} }),
    );
    expect(like).toMatchObject({ kind: 'reaction', userId: user, targetId: post, detail: { reaction: 'like' } });

    const unlike = toUserActivityRecord(
      envelope('content.reaction.updated', { postId: post, userId: user, type: null, reactionTotal: 0, reactionCounts: {} }),
    );
    expect(unlike).toBeNull();
  });

  it('đếm bình luận theo tác giả', () => {
    const record = toUserActivityRecord(
      envelope('content.comment.created', {
        commentId: '55555555-5555-4555-8555-555555555555',
        postId: post,
        postAuthorId: user,
        authorId: user,
        parentCommentId: null,
        body: 'hay quá',
        createdAt: '2026-11-17T10:00:00.000Z',
      }),
    );
    expect(record).toMatchObject({ kind: 'comment', userId: user, targetId: post });
  });

  it('đếm chia sẻ của người đã đăng nhập, bỏ qua khách', () => {
    expect(
      toUserActivityRecord(envelope('content.post.shared', { postId: post, userId: user, shareUrl: 'https://x' })),
    ).toMatchObject({ kind: 'share', userId: user });
    expect(
      toUserActivityRecord(envelope('content.post.shared', { postId: post, userId: null, shareUrl: 'https://x' })),
    ).toBeNull();
  });

  it('chỉ đếm xem đủ điều kiện của người đã đăng nhập', () => {
    const viewed = (viewerId: string | null, isQualified: boolean) =>
      envelope('content.post.viewed', {
        postId: post,
        viewerId,
        anonId: null,
        watchedMs: 20_000,
        durationSec: 60,
        isQualified,
        surface: 'reels',
      });
    expect(toUserActivityRecord(viewed(user, true))).toMatchObject({ kind: 'view', userId: user, detail: { surface: 'reels' } });
    expect(toUserActivityRecord(viewed(user, false))).toBeNull();
    expect(toUserActivityRecord(viewed(null, true))).toBeNull();
  });

  it('ghi lượt chat kèm câu hỏi đã rút gọn, không có câu trả lời', () => {
    const record = toUserActivityRecord(
      envelope(
        'ai.chat.turn.recorded',
        { conversationId: conversation, question: 'tour Đà Lạt 3 ngày', intent: 'search', answerKind: 'answer', isAction: false },
        { producer: 'ai-service', userId: user },
      ),
    );
    expect(record).toMatchObject({
      kind: 'chat',
      userId: user,
      targetId: null,
      detail: {
        conversationId: conversation,
        question: 'tour Đà Lạt 3 ngày',
        intent: 'search',
        answerKind: 'answer',
        isAction: false,
      },
    });
  });

  it('câu hỏi 120 ký tự có emoji vẫn nhận (đếm theo ký tự, không theo UTF-16)', () => {
    const chatEvent = (question: string) =>
      envelope(
        'ai.chat.turn.recorded',
        { conversationId: conversation, question, intent: null, answerKind: 'answer', isAction: true },
        { producer: 'ai-service', userId: user },
      );
    expect(toUserActivityRecord(chatEvent('😀'.repeat(120)))).toMatchObject({ kind: 'chat' });
    expect(() => toUserActivityRecord(chatEvent('😀'.repeat(121)))).toThrow();
  });

  it('sự kiện khác loại thì bỏ qua', () => {
    expect(toUserActivityRecord(envelope('ai.usage.recorded', {}))).toBeNull();
  });

  it('đúng loại nhưng sai hợp đồng thì ném lỗi để consumer bỏ qua', () => {
    expect(() => toUserActivityRecord(envelope('content.post.shared', { postId: 'không-phải-uuid' }))).toThrow();
  });
});

describe('retentionCutoff', () => {
  it('giữ đúng 90 ngày', () => {
    const now = new Date('2026-11-18T00:00:00.000Z');
    const cutoff = retentionCutoff(now);
    expect(USER_ACTIVITY_RETENTION_DAYS).toBe(90);
    expect(now.getTime() - cutoff.getTime()).toBe(90 * 86_400_000);
  });
});
