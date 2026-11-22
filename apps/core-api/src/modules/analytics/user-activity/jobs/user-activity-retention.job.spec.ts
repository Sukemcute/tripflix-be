import { describe, expect, it, vi } from 'vitest';
import type { AiInsightsStore } from '../../ai-insights/application/ai-insights.store.js';
import type { UserActivityStore } from '../application/user-activity.use-cases.js';
import { UserActivityRetentionJob } from './user-activity-retention.job.js';

const now = new Date('2026-11-18T00:00:00.000Z');
const cutoff = new Date(now.getTime() - 90 * 86_400_000);

function jobWith(activity: Partial<UserActivityStore>, ai: Partial<AiInsightsStore>) {
  return new UserActivityRetentionJob({ APP_ROLE: 'api' } as never, activity as UserActivityStore, ai as AiInsightsStore);
}

describe('UserActivityRetentionJob', () => {
  it('xoá hành vi và bỏ liên kết người dùng ở chi phí AI quá 90 ngày', async () => {
    const purgeBefore = vi.fn(async () => 3);
    const unlinkBefore = vi.fn(async () => 5);

    const handled = await jobWith({ purgeBefore }, { unlinkBefore }).runOnce(now);

    expect(purgeBefore).toHaveBeenCalledWith(cutoff);
    expect(unlinkBefore).toHaveBeenCalledWith(cutoff);
    expect(handled).toBe(8);
  });

  it('lỗi database chỉ ghi log, không ném ra ngoài', async () => {
    const purgeBefore = async () => {
      throw new Error('db down');
    };

    await expect(jobWith({ purgeBefore }, { unlinkBefore: vi.fn() }).runOnce(now)).resolves.toBe(0);
  });
});
