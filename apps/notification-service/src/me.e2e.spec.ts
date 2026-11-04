import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import request from 'supertest';
import { AppModule, ENV, SID_BLOCKLIST_PROVIDER, type Env } from './app.module.js';

// Chứng minh service khác kiểm được access token chỉ bằng JWKS qua HTTP, như khi gọi core-api thật.
async function keyPair(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey, jwk };
}

function accessToken(key: CryptoKey, { sid = 's-1', exp = '15m' as string | number } = {}) {
  return new SignJWT({ role: 'moderator', sid })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('u-1')
    .setIssuer('tripflix-core')
    .setAudience('tripflix')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

describe('notification-service kiểm access token qua JWKS', () => {
  let jwksServer: Server;
  let app: INestApplication;
  let core: Awaited<ReturnType<typeof keyPair>>;
  const blocklist = new MemorySidBlocklist();

  beforeAll(async () => {
    core = await keyPair('k1');
    jwksServer = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [core.jwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const { port } = jwksServer.address() as AddressInfo;

    const env: Env = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      PORT: 0,
      REDIS_URL: 'redis://127.0.0.1:6379',
      DATABASE_URL_NOTIFICATION: 'postgres://unused@127.0.0.1:5432/unused',
      JWKS_URL: `http://127.0.0.1:${port}/.well-known/jwks.json`,
      AUTH_JWT_ISSUER: 'tripflix-core',
      AUTH_JWT_AUDIENCE: 'tripflix',
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(SID_BLOCKLIST_PROVIDER)
      .useValue(blocklist)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('notifications', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => jwksServer.close(resolve));
  });

  const me = (token?: string) => {
    const req = request(app.getHttpServer()).get('/notifications/me');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('nhận token thật ký bằng khoá của core-api', async () => {
    const res = await me(await accessToken(core.privateKey)).expect(200);
    expect(res.body).toEqual({ userId: 'u-1', role: 'moderator' });
  });

  it('từ chối token ký bằng khoá khác (cùng kid)', async () => {
    const forged = await keyPair('k1');
    await me(await accessToken(forged.privateKey)).expect(401);
  });

  it('từ chối token hết hạn', async () => {
    await me(await accessToken(core.privateKey, { exp: Math.floor(Date.now() / 1000) - 5 })).expect(401);
  });

  it('từ chối khi thiếu token hoặc sid đã bị thu hồi', async () => {
    await me().expect(401);
    await blocklist.block('s-revoked', 900);
    await me(await accessToken(core.privateKey, { sid: 's-revoked' })).expect(401);
  });
});
