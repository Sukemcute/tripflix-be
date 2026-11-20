import type { EventEnvelope } from '@tripflix/contracts';
import type { TrendSignal } from '../domain/trend-signal.js';
import type { TrendSignalStore } from './ports.js';
import { TREND_SIGNAL_PURGE_BATCH, TrendSignalsUseCases } from './trend-signals.use-cases.js';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-19T02:00:00.000Z';

const envelope = (type: string, payload: Record<string, unknown>): EventEnvelope => ({
  eventId: '99999999-9999-4999-8999-999999999999',
  type,
  version: 1,
  occurredAt: AT,
  producer: 'core-api',
  userId: USER_ID,
  payload,
});

function setup() {
  const recorded: TrendSignal[] = [];
  const store = {
    record: vi.fn((signal: TrendSignal) => {
      recorded.push(signal);
      return Promise.resolve(true);
    }),
    purgeOlderThan: vi.fn<TrendSignalStore['purgeOlderThan']>(),
  };
  return { useCases: new TrendSignalsUseCases(store), store, recorded };
}

describe('TrendSignalsUseCases.recordEvent', () => {
  it('lưu lượt xem đủ với thời điểm của sự kiện', async () => {
    const { useCases, recorded } = setup();

    await useCases.recordEvent(
      envelope('content.post.viewed', {
        postId: POST_ID,
        viewerId: USER_ID,
        anonId: null,
        watchedMs: 20_000,
        durationSec: 40,
        isQualified: true,
        surface: 'reels',
      }),
    );

    expect(recorded).toEqual([
      { postId: POST_ID, kind: 'view', actorKey: `u:${USER_ID}`, isGuest: false, occurredAt: AT },
    ]);
  });

  it('lưu lượt bấm đặt', async () => {
    const { useCases, recorded } = setup();

    await useCases.recordEvent(
      envelope('content.post.booking_clicked', {
        postId: POST_ID,
        viewerId: USER_ID,
        anonId: null,
        hotelId: 'hotel_1',
        surface: 'reels_trip_plan',
      }),
    );

    expect(recorded).toMatchObject([{ kind: 'booking_click', actorKey: `u:${USER_ID}` }]);
  });

  it('không ghi lượt xem chưa đủ, sự kiện loại khác và payload sai schema, cũng không ném lỗi', async () => {
    const { useCases, store } = setup();

    await useCases.recordEvent(
      envelope('content.post.viewed', {
        postId: POST_ID,
        viewerId: USER_ID,
        anonId: null,
        watchedMs: 2_000,
        durationSec: 40,
        isQualified: false,
        surface: 'reels',
      }),
    );
    await useCases.recordEvent(envelope('ai.chat.turn.recorded', { anything: true }));
    await useCases.recordEvent(envelope('content.post.viewed', { postId: 'không-phải-uuid' }));

    expect(store.record).not.toHaveBeenCalled();
  });

  it('lỗi database thì ném ra để consumer giao lại', async () => {
    const { useCases, store } = setup();
    store.record.mockRejectedValueOnce(new Error('db down'));

    await expect(
      useCases.recordEvent(
        envelope('content.post.booking_clicked', {
          postId: POST_ID,
          viewerId: USER_ID,
          anonId: null,
          hotelId: null,
          surface: 'reels_trip_plan',
        }),
      ),
    ).rejects.toThrow('db down');
  });
});

describe('TrendSignalsUseCases.purgeExpired', () => {
  it('xoá theo lô tới khi một lô không đầy, mốc là 30 ngày trước', async () => {
    const { useCases, store } = setup();
    store.purgeOlderThan.mockResolvedValueOnce(TREND_SIGNAL_PURGE_BATCH).mockResolvedValueOnce(12);

    const deleted = await useCases.purgeExpired(new Date('2026-11-30T00:00:00.000Z'));

    expect(deleted).toBe(TREND_SIGNAL_PURGE_BATCH + 12);
    expect(store.purgeOlderThan).toHaveBeenCalledTimes(2);
    expect(store.purgeOlderThan).toHaveBeenCalledWith(
      new Date('2026-10-31T00:00:00.000Z'),
      TREND_SIGNAL_PURGE_BATCH,
    );
  });
});
