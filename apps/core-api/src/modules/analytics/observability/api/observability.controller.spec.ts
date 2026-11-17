import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import request from 'supertest';
import { AnalyticsModule } from '../../analytics.module.js';
import { TELEMETRY_ENV } from '../application/observability.service.js';

describe('observability HTTP authorization', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AnalyticsModule,
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: async (token) => {
              if (!['superadmin', 'moderator', 'member'].includes(token)) throw new InvalidAccessTokenError();
              return {
                userId: 'test-user',
                role: token as 'superadmin' | 'moderator' | 'member',
                sid: 'test-session',
                exp: Math.floor(Date.now() / 1000) + 300,
              };
            },
            blocklist: new MemorySidBlocklist(),
          }),
        }),
      ],
    })
      .overrideProvider(TELEMETRY_ENV)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  for (const path of ['', '/traces', `/traces/${'a'.repeat(32)}`]) {
    it(`requires a staff session and superadmin role for ${path || 'overview'}`, async () => {
      const client = request(app.getHttpServer());
      const url = `/api/analytics/observability${path}`;
      await client.get(url).expect(401);
      await client.get(url).set('Authorization', 'Bearer invalid').expect(401);
      await client.get(url).set('Authorization', 'Bearer member').expect(403);
      await client.get(url).set('Authorization', 'Bearer moderator').expect(403);
    });
  }
  it('serves explicit unconfigured state and rejects invalid filters for superadmin', async () => {
    const client = request(app.getHttpServer());
    const overview = await client
      .get('/api/analytics/observability')
      .set('Authorization', 'Bearer superadmin')
      .expect(200);
    expect(overview.headers['cache-control']).toBe('no-store');
    expect(overview.body.metricsSource.status).toBe('not_configured');
    await client
      .get('/api/analytics/observability?range=90d')
      .set('Authorization', 'Bearer superadmin')
      .expect(400);
    await client
      .get('/api/analytics/observability/traces/bad-id')
      .set('Authorization', 'Bearer superadmin')
      .expect(400);
  });
});
