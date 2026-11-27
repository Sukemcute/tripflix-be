import { loadAdmissionConfig } from './admission-config.js';

describe('Cấu hình bộ cấp suất commerce', () => {
  it('đọc đủ mặc định khi không đặt biến môi trường', () => {
    expect(loadAdmissionConfig({})).toEqual({ isEnabled: true, total: 80, txReserved: 20, txQueueMax: 50, txWaitMs: 2000 });
  });

  it('đọc số từ env và hiểu false là tắt', () => {
    expect(loadAdmissionConfig({
      COMMERCE_ADMIT_ENABLED: 'false',
      COMMERCE_ADMIT_TOTAL: '10',
      COMMERCE_ADMIT_TX_RESERVED: '3',
      COMMERCE_ADMIT_TX_QUEUE_MAX: '7',
      COMMERCE_ADMIT_TX_WAIT_MS: '400',
    })).toEqual({ isEnabled: false, total: 10, txReserved: 3, txQueueMax: 7, txWaitMs: 400 });
  });

  it.each(['80', '81'])('không cho suất dành riêng %s bằng hoặc lớn hơn tổng', (reserved) => {
    expect(() => loadAdmissionConfig({ COMMERCE_ADMIT_TX_RESERVED: reserved })).toThrow('Số suất dành riêng cho giao dịch phải nhỏ hơn tổng số suất.');
  });

  it('cho phép tắt hàng chờ và không dành riêng suất', () => {
    expect(loadAdmissionConfig({ COMMERCE_ADMIT_TX_RESERVED: '0', COMMERCE_ADMIT_TX_QUEUE_MAX: '0', COMMERCE_ADMIT_TX_WAIT_MS: '0' }))
      .toMatchObject({ txReserved: 0, txQueueMax: 0, txWaitMs: 0 });
  });

  it.each([
    ['COMMERCE_ADMIT_ENABLED', 'yes'],
    ['COMMERCE_ADMIT_TOTAL', '0'],
    ['COMMERCE_ADMIT_TOTAL', '3.5'],
    ['COMMERCE_ADMIT_TX_RESERVED', '-1'],
    ['COMMERCE_ADMIT_TX_QUEUE_MAX', '-1'],
    ['COMMERCE_ADMIT_TX_WAIT_MS', '-1'],
    ['COMMERCE_ADMIT_TX_WAIT_MS', '2147483648'],
    ['COMMERCE_ADMIT_TX_WAIT_MS', 'khong-phai-so'],
  ])('từ chối cấu hình không hợp lệ %s=%s', (key, value) => {
    expect(() => loadAdmissionConfig({ [key]: value })).toThrow();
  });
});
