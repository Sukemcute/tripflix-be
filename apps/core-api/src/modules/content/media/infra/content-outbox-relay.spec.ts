import type { EventEnvelope } from '@tripflix/contracts';
import { selectContentStream } from './content-outbox-relay.js';

const buildEnvelope = (type: string): EventEnvelope => ({
  eventId: '11111111-1111-4111-8111-111111111111',
  type,
  version: 1,
  occurredAt: '2026-11-05T08:00:00.000Z',
  producer: 'core-api/content',
  payload: {},
});

describe('selectContentStream', () => {
  it('việc chuyển mã đi stream của worker', () => {
    expect(selectContentStream(buildEnvelope('content.media.transcode_requested'))).toBe('stream:media');
  });

  it.each(['content.media.ready', 'content.media.failed', 'content.post.published'])('%s đi stream của content', (type) => {
    expect(selectContentStream(buildEnvelope(type))).toBe('stream:core.content');
  });

  it('loại không thuộc content thì báo lỗi, không gửi bừa', () => {
    expect(() => selectContentStream(buildEnvelope('access.user.registered'))).toThrow(
      'Chưa khai báo stream cho access.user.registered',
    );
  });
});
