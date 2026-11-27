import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { IdempotencyModule, MemoryIdempotencyStore } from '@tripflix/idempotency';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import { vi } from 'vitest';
import { applyGlobalPrefix } from '../../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../../platform/tokens.js';
import { registerTestAccount } from '../../../../platform/registration.fixture.js';
import {
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  ACTION_RATE_LIMITER,
  AccessModule,
  LOGIN_RATE_LIMITER,
  MemoryAccessStore,
  MemoryActionRateLimiter,
  MemoryLoginRateLimiter,
} from '../../../access/index.js';
import {
  DecideAppealUseCase,
  DecideCaseUseCase,
  SubmitAppealUseCase,
  SubmitReportUseCase,
} from '../application/moderation.use-cases.js';
import { ChangeVisibilityUseCase } from '../application/change-visibility.use-case.js';
import { ReviewQueueUseCase } from '../application/review-queue.use-case.js';
import { ClaimDeferredScansUseCase } from '../application/recover-screening.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { AdminModerationController, ReportsController } from './moderation.controller.js';
import { AdminModerationKeywordRulesController } from './keyword-rules.controller.js';
import { KeywordRulesUseCases } from '../application/keyword-rules.use-cases.js';
import { MediaFacade } from '../../media/media.facade.js';
import { PostPartsScreeningUseCase } from '../application/post-parts-screening.use-case.js';

@Global()
@Module({
  providers: [
    {
      provide: CORE_ENV,
      useValue: { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' },
    },
    { provide: DB_POOLS, useValue: {} },
    { provide: REDIS, useValue: {} },
  ],
  exports: [CORE_ENV, DB_POOLS, REDIS],
})
class TestPlatformModule {}

describe('TF32 HTTP roles, validation và Idempotency-Key', () => {
  let app: INestApplication;
  const store = new MemoryAccessStore();
  const submit = vi.fn().mockImplementation(async (input) => ({ id: randomUUID(), ...input }));
  const findCase = vi.fn();
  const detail = vi.fn();
  const queue = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const submitAppeal = vi.fn().mockResolvedValue({ id: randomUUID(), status: 'pending' });
  const decideAppeal = vi.fn().mockResolvedValue({ status: 'upheld' });
  const mine = vi.fn().mockResolvedValue([]);
  const stats = vi.fn().mockResolvedValue({ pendingTotal: 3, urgentSeverity: 80 });
  const coverOcrOverview = vi.fn().mockResolvedValue({
    counts: { all: 0, flagged: 0, failed: 0, inProgress: 0, passed: 0 },
    items: [],
    nextCursor: null,
  });
  const decide = vi.fn().mockResolvedValue({
    actionId: randomUUID(),
    changedCount: 1,
    previousStatus: 'visible',
    status: 'hidden',
  });
  const tokens: Record<string, string> = {};
  const keywordRule = { id: randomUUID(), keyword: 'câu thử nghiệm', enabled: true, updatedAt: new Date() };
  const keywordRules = {
    list: vi.fn().mockResolvedValue([keywordRule]),
    create: vi.fn().mockResolvedValue(keywordRule),
    update: vi.fn().mockResolvedValue({ ...keywordRule, enabled: false }),
  };
  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [
        TestPlatformModule,
        AccessModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        IdempotencyModule.forFeature({ useFactory: () => new MemoryIdempotencyStore() }),
      ],
      controllers: [AdminModerationController, ReportsController, AdminModerationKeywordRulesController],
      providers: [
        { provide: KeywordRulesUseCases, useValue: keywordRules },
        { provide: PostPartsScreeningUseCase, useValue: { detail: async () => ({ items: [], contentVersion: 'qa', imagePolicy: 'review_only' }), exists: async () => false, retry: vi.fn() } },
        { provide: MediaFacade, useValue: { getPlayback: async () => ({}) } },
        { provide: SubmitReportUseCase, useValue: { execute: submit } },
        { provide: SubmitAppealUseCase, useValue: { execute: submitAppeal } },
        { provide: DecideAppealUseCase, useValue: { execute: decideAppeal } },
        { provide: ReviewQueueUseCase, useValue: { execute: vi.fn(), recordEvidenceView: vi.fn() } },
        { provide: ClaimDeferredScansUseCase, useValue: { retry: vi.fn() } },
        { provide: DecideCaseUseCase, useValue: { execute: decide } },
        { provide: ChangeVisibilityUseCase, useValue: { execute: decide } },
        {
          provide: ModerationRepository,
          useValue: {
            queue,
            findCase,
            detail,
            stats,
            coverOcrOverview,
            log: async () => [],
            pendingAppeals: mine,
            decisionsByUser: mine,
            appealsByUser: mine,
            reportsByUser: mine,
          },
        },
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
    app = ref.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
    for (const role of ['member', 'moderator', 'superadmin'] as const) {
      const email = `${role}@tf32.test`;
      const password = 'test-password-123';
      const account = await registerTestAccount(app, { email, password, displayName: role });
      store.userRows.set(account.body.id, { ...store.userRows.get(account.body.id)!, role });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[role] = login.body.accessToken;
    }
  });
  afterAll(async () => {
    await app?.close();
  });
  const http = () => request(app.getHttpServer());
  it('chỉ superadmin được xem các mẫu luật kiểm duyệt dựng sẵn', async () => {
    const url = '/api/v1/admin/moderation/keyword-rules/built-in';
    const auth = { type: 'bearer' } as const;
    await http().get(url).expect(401);
    await http().get(url).auth(tokens.moderator!, auth).expect(403);
    const response = await http().get(url).auth(tokens.superadmin!, auth).expect(200);
    expect(response.body).toHaveLength(9);
    expect(response.body).toEqual(expect.arrayContaining([
      { code: 'PROFANITY', patterns: expect.arrayContaining(['óc chó']) },
      { code: 'CONTACT_INVITE', patterns: expect.arrayContaining(['dat coc', 'ib zalo']) },
    ]));
  });
  it('chỉ superadmin được xem và cấu hình quy tắc từ khóa', async () => {
    const url = '/api/v1/admin/moderation/keyword-rules';
    await http().get(url).expect(401);
    await http().get(url).auth(tokens.moderator!, { type: 'bearer' }).expect(403);
    const auth = { type: 'bearer' } as const;
    await http().get(url).auth(tokens.superadmin!, auth).expect(200);
    await http().post(url).auth(tokens.superadmin!, auth).set('Idempotency-Key', randomUUID())
      .send({ keyword: '!?', enabled: true }).expect(400);
    await http().post(url).auth(tokens.superadmin!, auth).set('Idempotency-Key', randomUUID())
      .send({ keyword: keywordRule.keyword, enabled: true }).expect(201);
    await http().patch(url + '/' + keywordRule.id).auth(tokens.superadmin!, auth)
      .set('Idempotency-Key', randomUUID()).send({}).expect(400);
    await http().patch(url + '/' + keywordRule.id).auth(tokens.superadmin!, auth)
      .set('Idempotency-Key', randomUUID()).send({ enabled: false }).expect(200);
    expect(keywordRules.update).toHaveBeenCalledWith(keywordRule.id, { enabled: false }, expect.any(String));
  });
  it('BE09: evidence and retry endpoints are staff-only and writes require idempotency', async () => {
    const id = randomUUID();
    const url = `/api/v1/admin/moderation/posts/${id}/parts`;
    await http().get(url).expect(401);
    await http().get(url).auth(tokens.member!, { type: 'bearer' }).expect(403);
    await http().get(url).auth(tokens.moderator!, { type: 'bearer' }).expect(200);
    const retry = `/api/v1/admin/moderation/parts/${id}/retry`;
    await http().post(retry).auth(tokens.member!, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).expect(403);
    await http().post(retry).auth(tokens.moderator!, { type: 'bearer' }).expect(400);
    await http().post(retry).auth(tokens.moderator!, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).expect(201);
  });
  it('BE09-cover-OCR: monitor is staff-only and validates status and pagination', async () => {
    const url = '/api/v1/admin/moderation/cover-ocr';
    await http().get(url).expect(401);
    await http().get(url).auth(tokens.member!, { type: 'bearer' }).expect(403);
    await http().get(`${url}?status=bad`).auth(tokens.moderator!, { type: 'bearer' }).expect(400);
    await http().get(`${url}?status=failed&limit=10&cursor=20`).auth(tokens.moderator!, { type: 'bearer' }).expect(200);
    expect(coverOcrOverview).toHaveBeenLastCalledWith({ status: 'failed', limit: 10, cursor: 20 });
  });
  it('bảo vệ API cá nhân và chỉ staff được xử lý khiếu nại', async () => {
    for (const path of ['me/moderation/decisions', 'me/moderation/appeals', 'me/reports']) {
      await http().get(`/api/v1/${path}`).expect(401);
      await http().get(`/api/v1/${path}`).auth(tokens.member!, { type: 'bearer' }).expect(200);
    }
    const id = randomUUID();
    const url = `/api/v1/admin/moderation/appeals/${id}/decisions`;
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ outcome: 'upheld' })
      .expect(403);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ outcome: 'bad' })
      .expect(400);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ outcome: 'upheld' })
      .expect(201);
  });
  it('validate nội dung khiếu nại và replay không tạo trùng', async () => {
    const id = randomUUID();
    const url = `/api/v1/moderation/decisions/${id}/appeals`;
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ reason: '   ' })
      .expect(400);
    const key = randomUUID();
    const before = submitAppeal.mock.calls.length;
    for (let i = 0; i < 2; i++)
      await http()
        .post(url)
        .auth(tokens.member!, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ reason: 'Xem lại' })
        .expect(201);
    expect(submitAppeal.mock.calls.length - before).toBe(1);
    expect(submitAppeal).toHaveBeenLastCalledWith(id, expect.any(String), 'Xem lại');
  });

  it('BE10: endpoint lease kiểm role, Idempotency-Key và mã phiên khi gia hạn', async () => {
    const url = '/api/v1/admin/moderation/queue/' + randomUUID() + '/lease';
    await http().post(url).send({ action: 'claim' }).expect(401);
    await http().post(url).auth(tokens.member!, { type: 'bearer' }).send({ action: 'claim' }).expect(403);
    await http().post(url).auth(tokens.moderator!, { type: 'bearer' }).send({ action: 'claim' }).expect(400);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'renew' })
      .expect(400);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'claim' })
      .expect(201);
    await http()
      .get('/api/v1/admin/moderation/queue?assignment=someone')
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(400);
  });

  it('chi tiết staff trả tên/email đúng tác giả; không trả dữ liệu xác thực, không lộ cho member hoặc queue', async () => {
    const author = (await store.users.insert({
      email: 'comment-author@example.com',
      passwordHash: 'private-test-hash',
      displayName: 'Tác giả bình luận',
      role: 'member',
    }))!;
    const postOwner = (await store.users.insert({
      email: 'post-owner@example.com',
      passwordHash: 'private-test-hash',
      displayName: 'Chủ bài',
      role: 'member',
    }))!;
    const id = randomUUID();
    const item = {
      id,
      authorId: author.id,
      targetType: 'comment',
      targetId: randomUUID(),
      status: 'pending',
    };
    findCase.mockResolvedValue(item);
    detail.mockResolvedValue({
      ...item,
      target: null,
      reports: [],
      actions: [],
      reviewAudit: [],
      postContext: { id: randomUUID(), authorId: postOwner.id, title: 'Bài nguồn' },
      parentComment: { id: randomUUID(), authorId: author.id, body: 'Bình luận cha' },
    });
    const contacts = vi.spyOn(store.users, 'findContactsByIds');
    await http()
      .get('/api/v1/admin/moderation/queue/' + id)
      .expect(401);
    await http()
      .get('/api/v1/admin/moderation/queue/' + id)
      .auth(tokens.member!, { type: 'bearer' })
      .expect(403);
    expect(contacts).not.toHaveBeenCalled();
    for (const role of ['moderator', 'superadmin']) {
      const response = await http()
        .get('/api/v1/admin/moderation/queue/' + id)
        .auth(tokens[role]!, { type: 'bearer' })
        .expect(200);
      expect(response.body.author).toEqual({
        id: author.id,
        displayName: 'Tác giả bình luận',
        email: 'comment-author@example.com',
      });
      expect(response.body.postContext.author).toEqual({
        id: postOwner.id,
        displayName: 'Chủ bài',
        email: 'post-owner@example.com',
      });
      expect(response.body.parentComment.author.id).toBe(author.id);
      expect(JSON.stringify(response.body)).not.toContain('private-test-hash');
      expect(response.body.author).not.toHaveProperty('passwordHash');
    }
    findCase.mockResolvedValue({ ...item, authorId: randomUUID() });
    expect(
      (
        await http()
          .get('/api/v1/admin/moderation/queue/' + id)
          .auth(tokens.moderator!, { type: 'bearer' })
          .expect(200)
      ).body.author,
    ).toBeNull();
    const list = await http()
      .get('/api/v1/admin/moderation/queue')
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('comment-author@example.com');
    contacts.mockRestore();
  });

  it('guest 401, member 403; moderator/superadmin đọc queue được', async () => {
    await http().get('/api/v1/admin/moderation/queue').expect(401);
    await http().get('/api/v1/admin/moderation/queue').auth(tokens.member!, { type: 'bearer' }).expect(403);
    for (const role of ['moderator', 'superadmin'])
      await http().get('/api/v1/admin/moderation/queue').auth(tokens[role]!, { type: 'bearer' }).expect(200);
  });
  it('thống kê kiểm duyệt: guest 401, member 403, staff đọc được với ngưỡng khẩn cấp 80 (TF89)', async () => {
    await http().get('/api/v1/admin/moderation/stats').expect(401);
    await http().get('/api/v1/admin/moderation/stats').auth(tokens.member!, { type: 'bearer' }).expect(403);
    for (const role of ['moderator', 'superadmin']) {
      const res = await http()
        .get('/api/v1/admin/moderation/stats')
        .auth(tokens[role]!, { type: 'bearer' })
        .expect(200);
      expect(res.body).toMatchObject({ pendingTotal: 3 });
    }
    expect(stats).toHaveBeenCalledWith(80, expect.any(String));
  });
  it('quyết định bắt buộc reasonCode và Idempotency-Key, replay chỉ gọi use case một lần', async () => {
    const url = `/api/v1/admin/moderation/queue/${randomUUID()}/decisions`;
    const body = { action: 'hide', reasonCode: 'HARASSMENT' };
    await http().post(url).auth(tokens.moderator!, { type: 'bearer' }).send(body).expect(400);
    await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'hide' })
      .expect(400);
    const key = randomUUID();
    const before = decide.mock.calls.length;
    const first = await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    const replay = await http()
      .post(url)
      .auth(tokens.moderator!, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(decide.mock.calls.length - before).toBe(1);
  });
  it('lọc tab lưu trữ bằng view và từ chối giá trị không hợp lệ', async () => {
    const url = '/api/v1/admin/moderation/queue';
    await http()
      .get(url)
      .query({ view: 'hidden', targetType: 'comment', cursor: '20' })
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(200);
    expect(queue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        view: 'hidden',
        targetType: 'comment',
        offset: 20,
      }),
    );
    await http()
      .get(url)
      .query({ targetType: 'comment', sort: 'newest', priority: 'high' })
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(200);
    expect(queue).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'newest', minSeverity: 80, targetType: 'comment' }),
    );
    await http().get(url).query({ view: 'unknown' }).auth(tokens.moderator!, { type: 'bearer' }).expect(400);
    await http().get(url).query({ sort: 'oldest' }).auth(tokens.moderator!, { type: 'bearer' }).expect(400);
    await http().get(url).query({ priority: 'urgent' }).auth(tokens.moderator!, { type: 'bearer' }).expect(400);
  });
  it('user báo cáo được, validate UUID/reason/detail, guest bị chặn', async () => {
    const url = `/api/v1/posts/${randomUUID()}/reports`;
    await http().post(url).send({ reasonCode: 'SCAM' }).expect(401);
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ reasonCode: 'SCAM' })
      .expect(201);
    await http()
      .post(url)
      .auth(tokens.member!, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ reasonCode: 'SCAM', reasonDetail: 'x'.repeat(501) })
      .expect(400);
    await http()
      .get('/api/v1/admin/moderation/queue?limit=-1')
      .auth(tokens.moderator!, { type: 'bearer' })
      .expect(400);
  });
});
