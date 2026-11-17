import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@tripflix/contracts';
import { ModerationSignals } from './moderation-signals.js';

const change = (payload: Record<string, unknown>, version = 1): EventEnvelope => ({
  eventId: '11111111-1111-4111-8111-111111111111', type: 'content.moderation.changed', version,
  occurredAt: new Date().toISOString(), producer: 'core-api/content', payload,
});

describe('staff moderation signals', () => {
  afterEach(() => vi.useRealTimers());
  it('coalesces valid changes and sends no payload', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const signals = new ModerationSignals(emit);
    const event = change({ scope: 'case', id: '11111111-1111-4111-8111-111111111111' });
    signals.handle(event);
    signals.handle(event);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(emit).toHaveBeenCalledExactlyOnceWith();
    signals.stop();
  });
  it('ignores invalid payloads, unknown types and unsupported versions', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const signals = new ModerationSignals(emit);
    signals.handle(change({ scope: 'case', id: 'invalid' }));
    signals.handle(change({ scope: 'case', id: '11111111-1111-4111-8111-111111111111' }, 2));
    signals.handle({ ...change({}), type: 'unrelated.event' });
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });
  it('cancels queued work on shutdown', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const signals = new ModerationSignals(emit);
    signals.handle(change({ scope: 'scan', id: '11111111-1111-4111-8111-111111111111' }));
    signals.stop();
    vi.runAllTimers();
    expect(emit).not.toHaveBeenCalled();
  });
  it('contains transport errors and can emit on the next change', () => {
    vi.useFakeTimers();
    const emit = vi.fn().mockImplementationOnce(() => { throw new Error('transport unavailable'); });
    const signals = new ModerationSignals(emit);
    const event = change({ scope: 'case', id: '11111111-1111-4111-8111-111111111111' });
    signals.handle(event);
    expect(() => vi.advanceTimersByTime(250)).not.toThrow();
    signals.handle(event);
    vi.advanceTimersByTime(250);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
