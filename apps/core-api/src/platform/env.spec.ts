import { DEFAULT_WEB_ORIGINS, coreEnvSchema } from './env.js';

const required = {
  DATABASE_URL_ACCESS: 'postgres://a',
  DATABASE_URL_CONTENT: 'postgres://c',
  DATABASE_URL_DISCOVERY: 'postgres://d',
  DATABASE_URL_ANALYTICS: 'postgres://an',
  DATABASE_URL_COMMERCE: 'postgres://co',
};

describe('AUTH_WEB_ORIGINS', () => {
  it('mặc định là web 3100 và admin 3200', () => {
    expect(coreEnvSchema.parse(required).AUTH_WEB_ORIGINS).toEqual(DEFAULT_WEB_ORIGINS);
  });

  it('tách theo dấu phẩy, bỏ khoảng trắng và phần tử rỗng', () => {
    const env = coreEnvSchema.parse({ ...required, AUTH_WEB_ORIGINS: ' https://tripflix.vn , https://admin.tripflix.vn,' });
    expect(env.AUTH_WEB_ORIGINS).toEqual(['https://tripflix.vn', 'https://admin.tripflix.vn']);
  });

  it('từ chối giá trị không phải origin (có đường dẫn, dấu / cuối, không phải URL)', () => {
    for (const bad of ['https://tripflix.vn/', 'https://tripflix.vn/app', 'tripflix.vn']) {
      expect(coreEnvSchema.safeParse({ ...required, AUTH_WEB_ORIGINS: bad }).success).toBe(false);
    }
  });
});
