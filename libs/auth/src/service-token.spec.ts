import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import request from 'supertest';
import { AuthModule } from './auth.module.js';
import { Authenticated } from './guards.js';
import { MemorySidBlocklist } from './revocation.js';
import { CurrentService, ServiceOnly, createServiceTokenVerifier, type ServiceCaller } from './service-token.js';
import { createAccessTokenVerifier } from './verifier.js';

const ISSUER = 'tripflix-core';

@Controller('internal')
class InternalController {
  @Get('search')
  @ServiceOnly('ai-service')
  search(@CurrentService() caller: ServiceCaller) {
    return { calledBy: caller.clientId };
  }

  @Get('any-service')
  @ServiceOnly()
  anyService(@CurrentService() caller: ServiceCaller) {
    return { calledBy: caller.clientId };
  }

  @Get('user-only')
  @Authenticated()
  userOnly() {
    return { ok: true };
  }
}

describe('Token service (@ServiceOnly)', () => {
  let app: INestApplication;
  let privateKey: CryptoKey;
  const http = (path: string, token?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  function signServiceToken({
    clientId = 'ai-service',
    audience = 'discovery',
    typ = 'service' as string | null,
    exp = '5m' as string | number,
  } = {}) {
    return new SignJWT(typ ? { typ } : {})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(clientId)
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  }

  function signUserToken() {
    return new SignJWT({ role: 'member', sid: 's-1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('u-1')
      .setIssuer(ISSUER)
      .setAudience('tripflix')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    const keys = createLocalJWKSet({ keys: [jwk] });

    @Module({
      imports: [
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: createAccessTokenVerifier({ keys, issuer: ISSUER, audience: 'tripflix' }),
            blocklist: new MemorySidBlocklist(),
            // Service này tên 'discovery': chỉ nhận token service có aud = discovery.
            serviceVerifier: createServiceTokenVerifier({ keys, issuer: ISSUER, audience: 'discovery' }),
          }),
        }),
      ],
      controllers: [InternalController],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('nhận token service đúng client và aud', async () => {
    const res = await http('/internal/search', await signServiceToken()).expect(200);
    expect(res.body).toEqual({ calledBy: 'ai-service' });
  });

  it('client không nằm trong @ServiceOnly thì 403', async () => {
    await http('/internal/search', await signServiceToken({ clientId: 'video-worker' })).expect(403);
    await http('/internal/any-service', await signServiceToken({ clientId: 'video-worker' })).expect(200);
  });

  it('token service cho service khác (sai aud), hết hạn, hoặc thiếu typ thì 401', async () => {
    await http('/internal/search', await signServiceToken({ audience: 'commerce' })).expect(401);
    await http('/internal/search', await signServiceToken({ exp: Math.floor(Date.now() / 1000) - 5 })).expect(401);
    await http('/internal/search', await signServiceToken({ typ: null })).expect(401);
    await http('/internal/search').expect(401);
  });

  it('token người dùng không gọi được API service, token service không gọi được API người dùng', async () => {
    await http('/internal/search', await signUserToken()).expect(401);
    await http('/internal/user-only', await signServiceToken({ audience: 'tripflix' })).expect(401);
    await http('/internal/user-only', await signUserToken()).expect(200);
  });
});
