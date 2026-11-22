import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import request from 'supertest';
import { AnalyticsModule } from '../../analytics.module.js';
import { AI_USAGE_STORE } from '../../ai-usage/application/ai-usage.use-cases.js';
import { AI_INSIGHTS_STORE } from '../../ai-insights/application/ai-insights.store.js';
import { USER_ACTIVITY_STORE } from '../../user-activity/application/user-activity.use-cases.js';
import { UserActivityRetentionJob } from '../../user-activity/jobs/user-activity-retention.job.js';
import { AiUsageConsumer } from '../../ai-usage/consumers/ai-usage.consumer.js';
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
      .overrideProvider(AI_USAGE_STORE)
      .useValue({ summarize: async () => [] })
      .overrideProvider(AiUsageConsumer)
      .useValue({})
      .overrideProvider(USER_ACTIVITY_STORE)
      .useValue({})
      .overrideProvider(AI_INSIGHTS_STORE)
      .useValue({})
      .overrideProvider(UserActivityRetentionJob)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  for (const path of [
    '/observability',
    '/observability/traces',
    `/observability/traces/${'a'.repeat(32)}`,
    '/ai-usage',
  ]) {
    it(`requires a staff session and superadmin role for ${path || 'overview'}`, async () => {
      const client = request(app.getHttpServer());
      const url = `/api/analytics${path}`;
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
  it('keeps the merged AI usage endpoint available beside observability', async () => {
    const report = await request(app.getHttpServer())
      .get('/api/analytics/ai-usage')
      .set('Authorization', 'Bearer superadmin')
      .expect(200);
    expect(report.headers['cache-control']).toBe('no-store');
    expect(report.body.total).toMatchObject({ calls: 0, costUsd: 0 });
  });
});
