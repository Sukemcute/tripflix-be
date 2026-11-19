import type { EventEnvelope } from '@tripflix/contracts';
import { describe, expect, it } from 'vitest';
import { toAiUsageRecord } from './ai-usage.js';

const user = '11111111-1111-4111-8111-111111111111';
const conversation = '33333333-3333-4333-8333-333333333333';
const turn = '55555555-5555-4555-8555-555555555555';

const usageEvent = (payload: Record<string, unknown>, userId?: string | null): EventEnvelope => ({
  eventId: '44444444-4444-4444-8444-444444444444',
  type: 'ai.usage.recorded',
  version: 1,
  occurredAt: '2026-11-18T10:00:00.000Z',
  producer: 'ai-service',
  ...(userId === undefined ? {} : { userId }),
  payload: { feature: 'chat', model: 'gpt-test', step: 'responder', inputTokens: 100, outputTokens: 20, costUsd: 0.001, estimated: true, ...payload },
});

describe('toAiUsageRecord gắn người dùng và lượt chat (SCRUM-179)', () => {
  it('ghi userId, conversationId, turnId và thời gian gọi khi có', () => {
    const record = toAiUsageRecord(usageEvent({ conversationId: conversation, turnId: turn, latencyMs: 850 }, user));
    expect(record).toMatchObject({ userId: user, conversationId: conversation, turnId: turn, latencyMs: 850, step: 'responder' });
  });

  it('sự kiện cũ, tóm tắt và kiểm duyệt không có các trường này thì để null', () => {
    expect(toAiUsageRecord(usageEvent({}))).toMatchObject({ userId: null, conversationId: null, turnId: null, latencyMs: null });
    expect(toAiUsageRecord(usageEvent({ feature: 'summary' }, null))).toMatchObject({ userId: null });
  });

  it('ai-service gửi null cho turnId, latencyMs, conversationId thì vẫn ghi, không mất sự kiện chi phí', () => {
    const record = toAiUsageRecord(usageEvent({ conversationId: null, turnId: null, latencyMs: null }, user));
    expect(record).toMatchObject({ userId: user, conversationId: null, turnId: null, latencyMs: null, costUsd: 0.001 });
  });

  it('turnId không phải UUID thì ném lỗi để consumer bỏ qua', () => {
    expect(() => toAiUsageRecord(usageEvent({ turnId: 'khong-phai-uuid' }, user))).toThrow();
  });
});
