import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { FollowsController } from './follows.controller.js';

const USER = '018D9F10-1234-7000-8000-000000000001';
const id = USER.toLowerCase();

function build(names: Map<string, string>) {
  const follows = { countFor: vi.fn().mockResolvedValue({ followerCount: 3, followingCount: 2 }) };
  const posts = { sumPublicReactions: vi.fn().mockResolvedValue(42) };
  const access = { getDisplayNames: vi.fn().mockResolvedValue(names) };
  const controller = new FollowsController(follows as never, access as never, posts as never, {} as never);
  return { controller, follows, posts };
}

describe('GET /v1/users/:userId/profile', () => {
  it('trả tên, số follow và tổng cảm xúc, id viết thường', async () => {
    const { controller, follows, posts } = build(new Map([[id, 'Bảo Lê']]));
    await expect(controller.getProfile(USER)).resolves.toEqual({
      id, displayName: 'Bảo Lê', followerCount: 3, followingCount: 2, likeCount: 42,
    });
    expect(follows.countFor).toHaveBeenCalledWith(id);
    expect(posts.sumPublicReactions).toHaveBeenCalledWith(id);
  });

  it('404 khi không có người dùng, không đếm gì', async () => {
    const { controller, follows } = build(new Map());
    await expect(controller.getProfile(USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(follows.countFor).not.toHaveBeenCalled();
  });
});
