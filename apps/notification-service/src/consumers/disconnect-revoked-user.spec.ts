import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@tripflix/contracts';
import { disconnectRevokedUser } from './notification-consumer.js';

const envelope = (type: string, payload: Record<string, unknown>): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: new Date().toISOString(),
  producer: 'core-api/access',
  userId: null,
  payload,
});

describe('disconnectRevokedUser', () => {
  const userId = randomUUID();
  const adminId = randomUUID();

  it('access.user.locked: ngắt mọi kết nối /ws của người bị khoá', () => {
    const realtime = { disconnectUser: vi.fn() };
    expect(
      disconnectRevokedUser(envelope('access.user.locked', { userId, lockedBy: adminId }), realtime),
    ).toBe(true);
    expect(realtime.disconnectUser).toHaveBeenCalledWith(userId);
  });

  it('access.user.role_changed: phiên cũ đã bị thu hồi nên cũng ngắt', () => {
    const realtime = { disconnectUser: vi.fn() };
    const payload = { userId, oldRole: 'member', newRole: 'moderator', changedBy: adminId };
    expect(disconnectRevokedUser(envelope('access.user.role_changed', payload), realtime)).toBe(true);
    expect(realtime.disconnectUser).toHaveBeenCalledWith(userId);
  });

  it('sự kiện khác hoặc payload sai: không ngắt ai', () => {
    const realtime = { disconnectUser: vi.fn() };
    expect(
      disconnectRevokedUser(envelope('access.user.unlocked', { userId, unlockedBy: adminId }), realtime),
    ).toBe(false);
    expect(
      disconnectRevokedUser(envelope('access.user.locked', { userId: 'không-phải-uuid' }), realtime),
    ).toBe(false);
    expect(realtime.disconnectUser).not.toHaveBeenCalled();
  });
});
