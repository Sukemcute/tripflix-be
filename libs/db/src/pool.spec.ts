import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_IDLE_IN_TRANSACTION_TIMEOUT_MS, APP_STATEMENT_TIMEOUT_MS, createPool, setPoolMax } from './index.js';

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

  it('setPoolMax đổi số kết nối tối đa lúc chạy, kẹp trong giới hạn', async () => {
    const pool = createPool({ url: 'postgres://user:pass@localhost:1/none', max: 10, applicationName: 'pool-spec' });
    expect(setPoolMax(pool, 15, { min: 10, max: 20 })).toBe(15);
    expect(pool.options.max).toBe(15);
    expect(setPoolMax(pool, 99, { min: 10, max: 20 })).toBe(20);
    expect(setPoolMax(pool, 3, { min: 10, max: 20 })).toBe(10);
    expect(pool.options.max).toBe(10);
    await pool.end();
  });

  it('L2: pool của app gửi statement_timeout và idle_in_transaction_session_timeout cho Postgres', async () => {
    const pool = createPool({ url: 'postgres://user:pass@localhost:1/none', max: 1, applicationName: 'pool-spec', statementTimeoutMs: APP_STATEMENT_TIMEOUT_MS, idleInTransactionTimeoutMs: APP_IDLE_IN_TRANSACTION_TIMEOUT_MS });
    const options = (pool as unknown as { options: Record<string, unknown> }).options;
    expect(options.statement_timeout).toBe(10_000);
    expect(options.idle_in_transaction_session_timeout).toBe(30_000);
    await pool.end();
  });

  it('L2: không truyền thì không giới hạn (migrate, seed tạo index có thể lâu)', async () => {
    const pool = createPool({ url: 'postgres://user:pass@localhost:1/none', max: 1, applicationName: 'pool-spec' });
    const options = (pool as unknown as { options: Record<string, unknown> }).options;
    expect(options.statement_timeout).toBeUndefined();
    expect(options.idle_in_transaction_session_timeout).toBeUndefined();
    await pool.end();
  });

  it('L2: client đang trong transaction bị Postgres cắt (25P03) thì không làm sập tiến trình', async () => {
    const pool = createPool({ url: 'postgres://user:pass@localhost:1/none', max: 1, applicationName: 'pool-spec' });
    const client = new EventEmitter();
    pool.emit('connect', client);
    const cut = Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), { code: '25P03' });
    expect(() => client.emit('error', cut)).not.toThrow();
    await pool.end();
  });
});
