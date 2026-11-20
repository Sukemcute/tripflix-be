import { describe, expect, it } from 'vitest';
import { ReelRecommendationQuerySchema } from './post-recommendations.controller.js';

describe('ReelRecommendationQuerySchema · fresh', () => {
  it('nhận đúng chuỗi true/false; "false" không bị đọc thành true', () => {
    expect(ReelRecommendationQuerySchema.parse({ fresh: 'true' }).fresh).toBe('true');
    expect(ReelRecommendationQuerySchema.parse({ fresh: 'false' }).fresh).toBe('false');
    expect(ReelRecommendationQuerySchema.parse({}).fresh).toBeUndefined();
  });

  it('giá trị khác thì báo lỗi tham số', () => {
    expect(ReelRecommendationQuerySchema.safeParse({ fresh: '1' }).success).toBe(false);
    expect(ReelRecommendationQuerySchema.safeParse({ fresh: 'yes' }).success).toBe(false);
  });
});
