import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from '../../../access/index.js';
import { registerTestAccount } from '../../../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoreEnv } from '../../../../platform/env.js';
import { applyGlobalPrefix } from '../../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../../platform/tokens.js';
import {
  AccessModule,
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  PASSWORD_HASHER,
  type PasswordHasher,
  MemoryAccessStore,
  MemoryLoginRateLimiter,
  registerServiceClient,
} from '../../../access/index.js';
import { PostSummaryController } from './post-summary.controller.js';
import { GetPostSummaryUseCase, SavePostSummaryUseCase } from '../application/index.js';
import { PostRepository } from '../infra/post.repository.js';
import { PostSummaryRepository } from '../infra/post-summary.repository.js';
import type { PostRecord, PostSummaryRecord } from '../../db/schema/index.js';

const env = { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' } as CoreEnv;

@Global()
@Module({
  providers: [
    { provide: CORE_ENV, useValue: env },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class FakePlatformModule {}

@Module({
  controllers: [PostSummaryController],
  providers: [
    {
      provide: PostRepository,
      useValue: {
        findById: async (id: string): Promise<PostRecord | null> => {
          if (id === '018d9f20-0000-7000-8000-000000000001') {
            return {
              id,
              authorId: '018d9f00-0000-7000-8000-000000000001',
              postType: 'video',
              status: 'published',
              visibility: 'public',
              isVerified: false,
              title: 'Bài viết test',
              body: 'Nội dung test',
              hashtags: [],
              mediaIds: [],
              coverMediaId: null,
              tripAttachment: null,
              reactionCounts: {},
              reactionTotal: 0,
              commentCount: 5,
              shareCount: 0,
              bookmarkCount: 0,
              publishedAt: new Date(),
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          }
          return null;
        },
      },
    },
    {
      provide: PostSummaryRepository,
      useFactory: () => {
        const summaries = new Map<string, PostSummaryRecord>();
        const save = async (data: any) => {
          const record: PostSummaryRecord = {
            postId: data.postId,
            status: data.status ?? 'ready',
            summary: data.summary ?? null,
            keyTakeaways: data.keyTakeaways ?? [],
            content: data.content ?? null,
            safety: data.safety ?? null,
            inputHash: data.inputHash ?? null,
            commentCountAtSummary: data.commentCountAtSummary ?? 0,
            promptVersion: data.promptVersion ?? null,
            modelName: data.modelName ?? null,
            generatedAt: data.generatedAt ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          summaries.set(data.postId, record);
          return record;
        };
        return {
          findByPostId: async (postId: string) => summaries.get(postId) ?? null,
          upsert: save,
          saveIfNewer: save,
        };
      },
    },
    {
      provide: SavePostSummaryUseCase,
      inject: [PostRepository, PostSummaryRepository],
      useFactory: (postRepo: PostRepository, summaryRepo: PostSummaryRepository) =>
        new SavePostSummaryUseCase(postRepo, summaryRepo),
    },
    {
      provide: GetPostSummaryUseCase,
      inject: [PostRepository, PostSummaryRepository],
      useFactory: (postRepo: PostRepository, summaryRepo: PostSummaryRepository) =>
        new GetPostSummaryUseCase(postRepo, summaryRepo),
    },
  ],
})
class TestSocialModule {}

describe('E2E: PUT & GET /api/v1/posts/:postId/ai-summary với Service Token', () => {
  let app: INestApplication;
  let store: MemoryAccessStore;
  let hasher: PasswordHasher;
  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const secrets: Record<string, string> = {};

  const validPostId = '018d9f20-0000-7000-8000-000000000001';

  const issueServiceToken = (clientId: string, audience = 'core-api') =>
    http().post('/api/auth/service-token').send({
      clientId,
      clientSecret: secrets[clientId],
      audience,
    });

  beforeAll(async () => {
    store = new MemoryAccessStore();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
        TestSocialModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(store)
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();

    hasher = moduleRef.get(PASSWORD_HASHER);
    for (const [clientId, audiences] of [
      ['ai-service', ['core-api']],
      ['video-worker', ['core-api']],
    ] as const) {
      secrets[clientId] = (
        await registerServiceClient(
          { store, hasher, userAudience: 'tripflix' },
          { clientId, audiences: [...audiences] },
        )
      ).clientSecret;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('ai-service gọi PUT với token hợp lệ: 200 OK và lưu tóm tắt', async () => {
    const aiToken = (await issueServiceToken('ai-service').expect(200)).body.accessToken;

    const res = await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(aiToken))
      .send({
        status: 'ready',
        summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
        keyTakeaways: ['Đi thuyền Tràng An lúc 7h sáng', 'Nên thuê xe máy'],
        inputHash: 'hash-abc-123',
        commentCount: 20,
        content: { pros: ['cảnh đẹp'], cons: ['đông đúc'] },
        safety: { requiresModeration: false },
        promptVersion: 'v1.0',
        modelName: 'gemini-1.5-flash',
      })
      .expect(200);

    expect(res.body).toMatchObject({
      postId: validPostId,
      status: 'ready',
      summary: 'Tóm tắt bài viết trải nghiệm du lịch Ninh Bình...',
      keyTakeaways: ['Đi thuyền Tràng An lúc 7h sáng', 'Nên thuê xe máy'],
      inputHash: 'hash-abc-123',
      commentCountAtSummary: 20,
      content: { pros: ['cảnh đẹp'], cons: ['đông đúc'] },
      safety: { requiresModeration: false },
      promptVersion: 'v1.0',
      modelName: 'gemini-1.5-flash',
    });
  });

  it('chặn dữ liệu body sai kiểu bằng ZodBody: 400 Bad Request (không văng 500)', async () => {
    const aiToken = (await issueServiceToken('ai-service').expect(200)).body.accessToken;

    const res = await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(aiToken))
      .send({
        status: 'invalid_status_value',
        commentCount: -10, // số âm sai schema
      })
      .expect(400);

    expect(res.body).toMatchObject({
      message: 'Dữ liệu gửi lên không hợp lệ',
      errors: expect.any(Array),
    });
  });

  it('bắt buộc summary khi status là ready: 400 Bad Request nếu summary rỗng hoặc để trống', async () => {
    const aiToken = (await issueServiceToken('ai-service').expect(200)).body.accessToken;

    // Trường hợp 1: status = ready nhưng không gửi summary
    const res1 = await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(aiToken))
      .send({
        status: 'ready',
      })
      .expect(400);

    expect(res1.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'summary',
          message: expect.stringContaining('không được để trống khi trạng thái là ready'),
        }),
      ]),
    );

    // Trường hợp 2: status = ready nhưng summary là chuỗi rỗng
    const res2 = await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(aiToken))
      .send({
        status: 'ready',
        summary: '   ',
      })
      .expect(400);

    expect(res2.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'summary',
        }),
      ]),
    );
  });

  it('chặn postId sai định dạng UUID bằng ParseUUIDPipe: 400 Bad Request', async () => {
    const aiToken = (await issueServiceToken('ai-service').expect(200)).body.accessToken;

    await http()
      .put('/api/v1/posts/not-a-valid-uuid/ai-summary')
      .set(bearer(aiToken))
      .send({
        summary: 'Tóm tắt bài viết',
      })
      .expect(400);

    await http().get('/api/v1/posts/not-a-valid-uuid/ai-summary').expect(400);
  });

  it('token người dùng bị từ chối ở API @ServiceOnly: 401 Unauthorized', async () => {
    await registerTestAccount(app, { email: 'member@example.com', password: 'mat-khau-an-toan-123', displayName: 'Thành' });

    const userLogin = await http()
      .post('/api/auth/login')
      .send({ email: 'member@example.com', password: 'mat-khau-an-toan-123' })
      .expect(200);

    const userToken = userLogin.body.accessToken;

    await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(userToken))
      .send({ summary: 'Cố tình gọi bằng user token' })
      .expect(401);
  });

  it('service khác (video-worker) gọi API ai-service: 403 Forbidden', async () => {
    const videoToken = (await issueServiceToken('video-worker').expect(200)).body.accessToken;

    await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(videoToken))
      .send({ summary: 'Gọi từ video worker' })
      .expect(403);
  });

  it('không có token: 401 Unauthorized', async () => {
    await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .send({ summary: 'Không có token' })
      .expect(401);
  });

  it('GET /api/v1/posts/:postId/ai-summary công khai: 200 khi có tóm tắt, 404 khi chưa có', async () => {
    // Đã lưu ở test đầu tiên -> trả về 200 kèm inputHash và keyTakeaways
    const res = await http().get(`/api/v1/posts/${validPostId}/ai-summary`).expect(200);
    expect(res.body).toMatchObject({
      postId: validPostId,
      status: 'ready',
      inputHash: 'hash-abc-123',
    });

    // UUID hợp lệ nhưng chưa có tóm tắt -> 404
    await http().get('/api/v1/posts/018d9f20-0000-7000-8000-000000000099/ai-summary').expect(404);
  });

  it('cho phép summary để trống khi status là no_comments hoặc insufficient_data: 200 OK', async () => {
    const aiToken = (await issueServiceToken('ai-service').expect(200)).body.accessToken;

    const res = await http()
      .put(`/api/v1/posts/${validPostId}/ai-summary`)
      .set(bearer(aiToken))
      .send({
        status: 'insufficient_data',
        commentCount: 2,
      })
      .expect(200);

    expect(res.body).toMatchObject({
      postId: validPostId,
      status: 'insufficient_data',
      summary: null,
      commentCountAtSummary: 2,
    });
  });
});
