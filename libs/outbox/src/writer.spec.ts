import { InvalidOutboxEventError, buildEventEnvelope } from './writer.js';

describe('buildEventEnvelope', () => {
  it('tạo phong bì hợp lệ với eventId, version mặc định 1, thời điểm xảy ra', () => {
    const now = new Date('2026-11-04T10:00:00Z');
    const envelope = buildEventEnvelope(
      { type: 'media.transcode_requested', payload: { mediaId: 'm-1' }, userId: '6f1c6a58-0f7e-4b51-9a57-3f0f2a4b9c11' },
      'core-api/content',
      now,
    );
    expect(envelope).toMatchObject({
      type: 'media.transcode_requested',
      version: 1,
      producer: 'core-api/content',
      occurredAt: '2026-11-04T10:00:00.000Z',
      payload: { mediaId: 'm-1' },
    });
    expect(envelope.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('từ chối type sai định dạng <nguồn>.<đối tượng>.<việc>', () => {
    expect(() => buildEventEnvelope({ type: 'TranscodeRequested', payload: {} }, 'core-api/content')).toThrow(
      InvalidOutboxEventError,
    );
  });

  it('từ chối userId không phải uuid', () => {
    expect(() =>
      buildEventEnvelope({ type: 'access.user.registered', payload: {}, userId: 'u-1' }, 'core-api/access'),
    ).toThrow(/userId/);
  });
});
