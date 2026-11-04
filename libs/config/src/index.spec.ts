import { z } from 'zod';
import { baseEnvSchema, loadEnv } from './index.js';

describe('loadEnv', () => {
  it('trả giá trị mặc định khi biến không bắt buộc bị thiếu', () => {
    expect(loadEnv(baseEnvSchema, {})).toEqual({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
  });

  it('ném lỗi liệt kê biến bắt buộc bị thiếu', () => {
    const schema = baseEnvSchema.extend({ DATABASE_URL: z.string() });
    expect(() => loadEnv(schema, {})).toThrow(/DATABASE_URL/);
  });
});
