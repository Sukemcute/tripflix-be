import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const mockTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue({}),
          onConflictDoNothing: vi.fn().mockResolvedValue({}),
        }),
      }),
    };

    const mockDb = {
      transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
    };

    const result = await seedContent(mockDb as any, seedPath);

    expect(result.posts).toBe(8);
    expect(result.comments).toBe(25);
    expect(result.mediaAssets).toBe(8);
    expect(result.reactions).toBe(10);
    expect(result.bookmarks).toBe(5);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });
});
