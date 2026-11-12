import { isDatabaseUnavailable } from './database-unavailable.js';

describe('isDatabaseUnavailable', () => {
  it('nhận diện mã lỗi mạng của pg', () => {
    expect(isDatabaseUnavailable({ code: 'ECONNREFUSED' })).toBe(true);
  });

  it.each(['57P01', '53300', '08006'])('nhận diện mã SQLSTATE %s', (code) => {
    expect(isDatabaseUnavailable({ code })).toBe(true);
  });

  it('nhận diện lỗi hết hạn kết nối', () => {
    expect(isDatabaseUnavailable(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  it('nhận diện lỗi qua một lớp cause', () => {
    const errors = [{ code: 'ECONNREFUSED' }, new Error('timeout exceeded when trying to connect')];

    for (const cause of errors) {
      expect(isDatabaseUnavailable({ message: 'Failed query', cause })).toBe(true);
    }
  });

  it('nhận diện lỗi qua hai lớp cause', () => {
    const errors = [{ code: 'ECONNREFUSED' }, new Error('timeout exceeded when trying to connect')];

    for (const cause of errors) {
      expect(isDatabaseUnavailable({ message: 'Failed query', cause: { cause } })).toBe(true);
    }
  });

  it('bỏ qua lỗi nghiệp vụ', () => {
    expect(isDatabaseUnavailable({ name: 'CommerceError', code: 'conflict', message: 'Không thể giữ chỗ' })).toBe(false);
  });

  it('bỏ qua lỗi thông thường', () => {
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
  });

  it('bỏ qua lỗi trùng dữ liệu', () => {
    expect(isDatabaseUnavailable({ code: '23505' })).toBe(false);
  });

  it('bỏ qua giá trị rỗng', () => {
    expect(isDatabaseUnavailable(undefined)).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});
