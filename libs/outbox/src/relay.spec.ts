import type { EventEnvelope } from '@tripflix/contracts';
import type { EventBus, StreamName } from '@tripflix/event-bus';
import { OutboxRelay } from './relay.js';
import { MemoryOutboxStore } from './store.js';
import { buildEventEnvelope } from './writer.js';

const STREAM: StreamName = 'stream:core.content';

function createEvents(count: number): EventEnvelope[] {
  return Array.from({ length: count }, (_, i) =>
    buildEventEnvelope(
      { type: 'media.transcode_requested', payload: { order: i } },
      'core-api/content',
      new Date(Date.UTC(2026, 10, 4, 10, 0, i)),
    ),
  );
}

function createBus({ failOnOrder }: { failOnOrder?: number } = {}) {
  const published: EventEnvelope[] = [];
  const bus: EventBus = {
    publish: async (_stream, event) => {
      if (event.payload.order === failOnOrder) throw new Error('Redis không phản hồi');
      published.push(event);
      return `${published.length}-0`;
    },
  };
  return { bus, published };
}

describe('OutboxRelay', () => {
  it('gửi theo thứ tự xảy ra rồi mới đánh dấu đã gửi', async () => {
    const store = new MemoryOutboxStore();
    for (const e of createEvents(3).reverse()) store.add(e);
    const { bus, published } = createBus();

    const result = await new OutboxRelay({ store, bus, stream: STREAM }).publishPending();

    expect(result).toEqual({ publishedCount: 3, failedCount: 0 });
    expect(published.map((e) => e.payload.order)).toEqual([0, 1, 2]);
    expect([...store.rows.values()].every((r) => r.publishedAt !== null)).toBe(true);
  });

  it('gửi lỗi thì giữ sự kiện để thử lại, sự kiện mới không vượt lên trước', async () => {
    let now = 0;
    const store = new MemoryOutboxStore(() => now);
    const events = createEvents(3);
    for (const e of events) store.add(e);
    const { bus, published } = createBus({ failOnOrder: 1 });
    const relay = new OutboxRelay({ store, bus, stream: STREAM, lockSeconds: 30 });

    expect(await relay.publishPending()).toEqual({ publishedCount: 1, failedCount: 1 });
    expect(store.rows.get(events[1]!.eventId)).toMatchObject({
      publishedAt: null,
      attempts: 1,
      lastError: 'Redis không phản hồi',
    });

    // Còn khoá: không gửi gì, kể cả sự kiện mới đến sau.
    store.add(
      buildEventEnvelope(
        { type: 'media.transcode_requested', payload: { order: 3 } },
        'core-api/content',
        new Date(Date.UTC(2026, 10, 4, 10, 0, 3)),
      ),
    );
    expect(await relay.publishPending()).toEqual({ publishedCount: 0, failedCount: 0 });

    // Hết khoá: gửi tiếp đúng thứ tự 1, 2, 3.
    now += 31_000;
    const healthy = createBus();
    const retry = await new OutboxRelay({ store, bus: healthy.bus, stream: STREAM }).publishPending();
    expect(retry).toEqual({ publishedCount: 3, failedCount: 0 });
    expect(healthy.published.map((e) => e.payload.order)).toEqual([1, 2, 3]);
    expect(published).toHaveLength(1);
  });

  it('hai relay chạy cùng lúc: mỗi sự kiện gửi đúng một lần, đúng thứ tự', async () => {
    const store = new MemoryOutboxStore();
    for (const e of createEvents(5)) store.add(e);
    const { bus, published } = createBus();
    const a = new OutboxRelay({ store, bus, stream: STREAM, batchSize: 2 });
    const b = new OutboxRelay({ store, bus, stream: STREAM, batchSize: 2 });

    for (let round = 0; round < 5; round += 1) await Promise.all([a.publishPending(), b.publishPending()]);

    expect(published.map((e) => e.payload.order)).toEqual([0, 1, 2, 3, 4]);
  });

  describe('hàm chọn stream', () => {
    const MEDIA_TYPE = 'content.media.transcode_requested';
    const CONTENT_TYPE = 'content.media.ready';

    function createEvent(type: string, order: number): EventEnvelope {
      return buildEventEnvelope({ type, payload: { order } }, 'core-api/content', new Date(Date.UTC(2026, 10, 4, 10, 0, order)));
    }

    function createRoutingBus() {
      const publishedByStream = new Map<StreamName, unknown[]>();
      const bus: EventBus = {
        publish: async (stream, event) => {
          publishedByStream.set(stream, [...(publishedByStream.get(stream) ?? []), event.payload.order]);
          return '1-0';
        },
      };
      return { bus, publishedByStream };
    }

    function selectStream(envelope: EventEnvelope): StreamName {
      if (envelope.type === MEDIA_TYPE) return 'stream:media';
      if (envelope.type === CONTENT_TYPE) return 'stream:core.content';
      throw new Error(`Chưa khai báo stream cho ${envelope.type}`);
    }

    it('chia đúng 2 stream, giữ thứ tự trong từng stream, mỗi sự kiện đi một stream', async () => {
      const store = new MemoryOutboxStore();
      const events = [
        createEvent(MEDIA_TYPE, 0),
        createEvent(CONTENT_TYPE, 1),
        createEvent(MEDIA_TYPE, 2),
        createEvent(CONTENT_TYPE, 3),
      ];
      for (const e of [...events].reverse()) store.add(e);
      const { bus, publishedByStream } = createRoutingBus();

      const result = await new OutboxRelay({ store, bus, stream: selectStream }).publishPending();

      expect(result).toEqual({ publishedCount: 4, failedCount: 0 });
      expect(publishedByStream.get('stream:media')).toEqual([0, 2]);
      expect(publishedByStream.get('stream:core.content')).toEqual([1, 3]);
      expect([...publishedByStream.keys()]).toHaveLength(2);
    });

    it('hàm ném lỗi thì báo onError, markFailed, sự kiện sau chưa gửi, không có stream mặc định', async () => {
      const store = new MemoryOutboxStore();
      const events = [createEvent(MEDIA_TYPE, 0), createEvent('content.unknown.happened', 1), createEvent(MEDIA_TYPE, 2)];
      for (const e of events) store.add(e);
      const { bus, publishedByStream } = createRoutingBus();
      const onError = vi.fn();

      const result = await new OutboxRelay({ store, bus, stream: selectStream, onError }).publishPending();

      expect(result).toEqual({ publishedCount: 1, failedCount: 1 });
      expect(publishedByStream.get('stream:media')).toEqual([0]);
      expect([...publishedByStream.keys()]).toEqual(['stream:media']);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), events[1]);
      expect(store.rows.get(events[1]!.eventId)).toMatchObject({
        publishedAt: null,
        attempts: 1,
        lastError: 'Chưa khai báo stream cho content.unknown.happened',
      });
      expect(store.rows.get(events[2]!.eventId)).toMatchObject({ publishedAt: null, attempts: 0 });
    });
  });

  it('start chạy vòng lặp, stop dừng hẳn', async () => {
    const store = new MemoryOutboxStore();
    for (const e of createEvents(2)) store.add(e);
    const { bus, published } = createBus();
    const relay = new OutboxRelay({ store, bus, stream: STREAM, intervalMs: 10 });

    relay.start();
    await vi.waitFor(() => expect(published).toHaveLength(2));
    await relay.stop();
    store.add(createEvents(1)[0]!);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(published).toHaveLength(2);
  });
});
