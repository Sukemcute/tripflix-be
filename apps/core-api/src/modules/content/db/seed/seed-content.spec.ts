import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { posts } from '../schema/index.js';
import { seedContent, CONTENT_SEED_FILE } from './seed-content.js';

describe('Seed Content (TF07)', () => {
  const seedPath = resolve(process.cwd(), CONTENT_SEED_FILE);

  it('file posts-seed.json tồn tại và có cấu trúc dữ liệu hợp lệ', () => {
    const raw = readFileSync(seedPath, 'utf8');
    const data = JSON.parse(raw);

    expect(data.mediaAssets).toBeInstanceOf(Array);
    expect(data.posts).toBeInstanceOf(Array);
    expect(data.comments).toBeInstanceOf(Array);
    expect(data.reactions).toBeInstanceOf(Array);
    expect(data.bookmarks).toBeInstanceOf(Array);

    expect(data.mediaAssets.length).toBeGreaterThanOrEqual(5);
    expect(data.posts.length).toBeGreaterThanOrEqual(5);
    expect(data.comments.length).toBeGreaterThanOrEqual(15);
  });

  it('các bài đăng có đầy đủ thông tin lộ trình, PII hợp lệ và media', () => {
    const data = JSON.parse(readFileSync(seedPath, 'utf8'));

    for (const post of data.posts) {
      expect(post.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(post.title).toBeTruthy();
      expect(post.body).toBeTruthy();
      expect(['video', 'vlog']).toContain(post.postType);
      expect(post.status).toBe('published');
      expect(post.visibility).toBe('public');
      expect(post.mediaIds.length).toBeGreaterThan(0);

      // Kiểm tra tripAttachment
      if (post.tripAttachment) {
        expect(post.tripAttachment.destinationName).toBeTruthy();
        expect(post.tripAttachment.priceDisclaimer).toBe('Giá chỉ mang tính chất tham khảo');
      }
    }
  });

  it('video seed đủ thông tin để phát và bài nào cũng trỏ vào video có thật', () => {
    const data = JSON.parse(readFileSync(seedPath, 'utf8'));
    const assetIds = new Set(data.mediaAssets.map((asset: any) => asset.id));

    for (const asset of data.mediaAssets) {
      expect(asset.status).toBe('ready');
      expect(asset.levels).toContain(360);
      // Không có dấu / cuối, vì MediaFacade tự ghép thêm khi tạo link.
      expect(asset.hlsPrefix).toMatch(new RegExp(`^dev/phong/videos/[0-9a-f-]{36}/r1$`));
    }
    for (const post of data.posts) {
      for (const mediaId of post.mediaIds) expect(assetIds.has(mediaId)).toBe(true);
    }
  });

  it('các bình luận đều trỏ vào bài đăng hợp lệ và reply đúng cấu trúc 1 cấp', () => {
    const data = JSON.parse(readFileSync(seedPath, 'utf8'));
    const postIds = new Set(data.posts.map((p: any) => p.id));
    const commentIds = new Set(data.comments.map((c: any) => c.id));

    for (const comment of data.comments) {
      expect(postIds.has(comment.postId)).toBe(true);
      expect(comment.body).toBeTruthy();

      if (comment.parentCommentId) {
        // Comment cha phải tồn tại
        expect(commentIds.has(comment.parentCommentId)).toBe(true);
        // Comment cha không được là một reply khác (chặn reply cấp 2)
        const parent = data.comments.find((c: any) => c.id === comment.parentCommentId);
        expect(parent.parentCommentId).toBeNull();
      }
    }
  });

  it('seedContent nạp dữ liệu thành công vào mock DB và trả về đúng số lượng', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue({});
    const onConflictDoNothing = vi.fn().mockResolvedValue({});
    const updateSet = vi.fn().mockResolvedValue({});
    const mockTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate,
          onConflictDoNothing,
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: updateSet,
      }),
    };

    const mockDb = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const result = await seedContent(mockDb as any, seedPath);

    expect(result.posts).toBe(10);
    expect(result.comments).toBe(25);
    expect(result.mediaAssets).toBe(10);
    expect(result.reactions).toBe(759);
    expect(result.bookmarks).toBe(5);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.update).toHaveBeenCalledWith(posts);
    expect(updateSet).toHaveBeenCalledTimes(1);

    // Đảm bảo upsert bài viết không ghi đè các cột bộ đếm hiện có trong DB.
    const postUpsertCalls = onConflictDoUpdate.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg?.target === posts.id);
    expect(postUpsertCalls.length).toBe(10);
    for (const call of postUpsertCalls) {
      expect(call.set).not.toHaveProperty('commentCount');
      expect(call.set).not.toHaveProperty('reactionCounts');
      expect(call.set).not.toHaveProperty('reactionTotal');
      expect(call.set).not.toHaveProperty('shareCount');
      expect(call.set).not.toHaveProperty('bookmarkCount');
    }
  });
});
