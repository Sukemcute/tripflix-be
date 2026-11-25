import { describe, expect, it } from 'vitest';
import { PostRecommendationQuerySchema } from './post-recommendations.controller.js';

describe('PostRecommendationQuerySchema · fresh', () => {
  it('nhận đúng chuỗi true/false; "false" không bị đọc thành true', () => {
    expect(PostRecommendationQuerySchema.parse({ fresh: 'true' }).fresh).toBe('true');
    expect(PostRecommendationQuerySchema.parse({ fresh: 'false' }).fresh).toBe('false');
    expect(PostRecommendationQuerySchema.parse({}).fresh).toBeUndefined();
  });

  it('giá trị khác thì báo lỗi tham số', () => {
    expect(PostRecommendationQuerySchema.safeParse({ fresh: '1' }).success).toBe(false);
    expect(PostRecommendationQuerySchema.safeParse({ fresh: 'yes' }).success).toBe(false);
  });
});
