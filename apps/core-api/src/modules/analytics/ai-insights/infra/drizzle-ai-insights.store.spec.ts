import { describe, expect, it } from 'vitest';
import { toStepRow, toTimePoint, toTraceRow, toUserRow } from './drizzle-ai-insights.store.js';

describe('đổi kiểu dòng SQL thô của pg', () => {
  it('thời gian dạng chuỗi sang Date, bigint và numeric dạng chuỗi sang số (lỗi 500 ở #276)', () => {
    const point = toTimePoint({ at: '2026-11-17 17:00:00+00', calls: 3, input_tokens: '1200', output_tokens: '80', cost_usd: '0.0123' });
    expect(point.at.toISOString()).toBe('2026-11-17T17:00:00.000Z');
    expect(point).toMatchObject({ calls: 3, inputTokens: 1200, outputTokens: 80, costUsd: 0.0123 });
  });

  it('dòng xếp hạng người dùng', () => {
    const row = toUserRow({ user_id: 'u1', calls: 4, conversations: 2, input_tokens: '500', output_tokens: '50', cost_usd: '0.002', last_at: '2026-11-18 10:14:01.171259+00' });
    expect(row).toMatchObject({ userId: 'u1', conversations: 2, inputTokens: 500, costUsd: 0.002 });
    expect(row.lastAt.toISOString()).toBe('2026-11-18T10:14:01.171Z');
  });

  it('dòng trace: lượt chat cũ chưa có turnId và chưa có bước thì token bằng 0', () => {
    const row = toTraceRow({
      event_id: 'e1',
      turn_id: null,
      user_id: 'u1',
      occurred_at: '2026-11-18 10:14:01+00',
      question: 'tour Huế',
      intent: null,
      answer_kind: 'answer',
      is_action: false,
      latency_ms: null,
      steps: 0,
      input_tokens: '0',
      output_tokens: '0',
      cost_usd: '0',
    });
    expect(row).toMatchObject({ turnId: null, intent: null, isAction: false, latencyMs: null, steps: 0, costUsd: 0 });
  });

  it('dòng trace có đủ bước và thời gian', () => {
    const row = toTraceRow({ event_id: 'e2', turn_id: 't1', user_id: 'u1', occurred_at: '2026-11-18 10:14:01+00', question: 'q', intent: 'search', answer_kind: 'error', is_action: true, latency_ms: '1800', steps: 2, input_tokens: '2400', output_tokens: '300', cost_usd: '0.0004' });
    expect(row).toMatchObject({ turnId: 't1', answerKind: 'error', isAction: true, latencyMs: 1800, steps: 2, inputTokens: 2400 });
  });

  it('bước gọi LLM: token và thời gian có thể null', () => {
    const step = toStepRow({ id: 's1', step: 'controller', model: 'gpt-test', input_tokens: null, output_tokens: null, cost_usd: '0', latency_ms: null, occurred_at: '2026-11-18 10:14:01+00', is_estimated: true });
    expect(step).toMatchObject({ step: 'controller', inputTokens: null, outputTokens: null, latencyMs: null, isEstimated: true });
  });
});
