import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool } from './index.js';

describe('createPool', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lỗi của kết nối rảnh (máy chủ ngắt, 57P01) chỉ ghi cảnh báo, không làm sập tiến trình', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const pool = createPool({ url: 'postgres://user:pass@localhost:1/none', max: 1, applicationName: 'pool-spec' });
    const terminated = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    // Không có listener thì emit('error') ném lỗi ngay tại đây.
    expect(() => pool.emit('error', terminated)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pool-spec'), { code: 'TRIPFLIX_PG_IDLE_ERROR' });
    expect(warn.mock.calls[0]![0]).toContain('57P01');
    await pool.end();
  });
});
