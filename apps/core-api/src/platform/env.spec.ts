import { DEFAULT_WEB_ORIGINS, coreEnvSchema } from './env.js';

const required = {
  DATABASE_URL_ACCESS: 'postgres://a',
  DATABASE_URL_CONTENT: 'postgres://c',
  DATABASE_URL_DISCOVERY: 'postgres://d',
  DATABASE_URL_ANALYTICS: 'postgres://an',
  DATABASE_URL_COMMERCE: 'postgres://co',
};

describe('AUTH_JWT_PREVIOUS_JWKS', () => {
  const jwk = { kty: 'EC', crv: 'P-256', x: 'x1', y: 'y1', kid: 'k1', alg: 'ES256', use: 'sig' };

  it('nhận nguyên JSON của /.well-known/jwks.json, để trống là không có', () => {
    const env = coreEnvSchema.parse({ ...required, AUTH_JWT_PREVIOUS_JWKS: JSON.stringify({ keys: [jwk] }) });
    expect(env.AUTH_JWT_PREVIOUS_JWKS?.keys).toEqual([{ kty: 'EC', crv: 'P-256', x: 'x1', y: 'y1', kid: 'k1' }]);
    expect(coreEnvSchema.parse({ ...required, AUTH_JWT_PREVIOUS_JWKS: '' }).AUTH_JWT_PREVIOUS_JWKS).toBeUndefined();
  });

  it('từ chối JSON hỏng, khoá riêng (có d), thiếu kid, danh sách rỗng', () => {
    const { kid: _kid, ...noKid } = jwk;
    for (const bad of ['{keys', JSON.stringify({ keys: [{ ...jwk, d: 'secret' }] }), JSON.stringify({ keys: [noKid] }), '{"keys":[]}']) {
      expect(coreEnvSchema.safeParse({ ...required, AUTH_JWT_PREVIOUS_JWKS: bad }).success).toBe(false);
    }
  });
});

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
