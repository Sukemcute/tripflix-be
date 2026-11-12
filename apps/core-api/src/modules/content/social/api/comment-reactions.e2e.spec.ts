import { ACTION_RATE_LIMITER, MemoryActionRateLimiter } from '../../../access/index.js';
import { registerTestAccount, seedLegacyAccount } from '../../../../platform/registration.fixture.js';
import 'reflect-metadata';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { InMemoryObjectStorage } from '@tripflix/storage';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CoreEnv } from '../../../../platform/env.js';
import { applyGlobalPrefix } from '../../../../platform/http.js';
import { CORE_ENV, DB_POOLS, REDIS } from '../../../../platform/tokens.js';
import {
  AccessModule,
  ACCESS_SID_BLOCKLIST,
  ACCESS_STORE,
  LOGIN_RATE_LIMITER,
  MemoryAccessStore,
  MemoryLoginRateLimiter,
} from '../../../access/index.js';
import { ContentModule, CONTENT_DB } from '../../content.module.js';
import { MEDIA_ASSET_STORE, OBJECT_STORAGE } from '../../media/application/ports.js';
import { MemoryMediaAssetStore } from '../../media/infra/memory/memory-media-asset.store.js';
import { FEED_STORE } from '../../feed/application/ports.js';
import { PostRepository } from '../infra/post.repository.js';
import { CommentRepository } from '../infra/comment.repository.js';
import { CommentReactionRepository } from '../infra/comment-reaction.repository.js';
import { CONTENT_OUTBOX } from '../application/ports/content-outbox.port.js';
import type { CommentRecord, PostRecord } from '../../db/schema/index.js';

const env = { NODE_ENV: 'test', AUTH_JWT_ISSUER: 'tripflix-core', AUTH_JWT_AUDIENCE: 'tripflix' } as CoreEnv;
const PASSWORD = 'mat-khau-an-toan-123';

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

describe('E2E: PUT & GET Comment Reactions (Thả tim bình luận - TF25)', () => {
  let app: INestApplication;
  let userAToken: string;
  let userBToken: string;

  const validPostId = '018d9f20-0000-7000-8000-000000000001';
  const validCommentId = '018d9f30-0000-7000-8000-000000000001';

  const mockPost: PostRecord = {
    id: validPostId,
    authorId: '018d9f00-0000-7000-8000-000000000001',
    postType: 'video',
    status: 'published',
    visibility: 'public',
    isVerified: false,
    title: 'Bài viết test reaction',
    body: 'Nội dung test',
    hashtags: [],
    mediaIds: [],
    coverMediaId: null,
    tripAttachment: null,
    reactionCounts: {},
    reactionTotal: 0,
    commentCount: 1,
    shareCount: 0,
    bookmarkCount: 0,
    publishedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const commentsStore = new Map<string, CommentRecord>([
    [
      validCommentId,
      {
        id: validCommentId,
        postId: validPostId,
        authorId: '018d9f00-0000-7000-8000-000000000001',
        status: 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        parentCommentId: null,
        body: 'Bình luận test thả tim',
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
  ]);

  const reactionStore = new Map<string, { commentId: string; userId: string; type: 'like' }>();
  const makeKey = (cId: string, uId: string) => `${cId}:${uId}`;

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const mockPostRepo = {
      findById: async (id: string) => (id === validPostId ? mockPost : null),
      incrementCounter: async () => {},
    };

    const mockCommentRepo = {
      findById: async (id: string) => {
        const c = commentsStore.get(id);
        return c && !c.deletedAt ? { ...c } : null;
      },
      findByPostId: async () => Array.from(commentsStore.values()).filter((c) => !c.deletedAt),
      countByPostId: async () => Array.from(commentsStore.values()).filter((c) => !c.deletedAt).length,
      countRepliesByParentIds: async (parentIds: string[]) => {
        const counts = new Map<string, number>();
        for (const c of commentsStore.values()) {
          if (!c.deletedAt && c.parentCommentId && parentIds.includes(c.parentCommentId)) {
            counts.set(c.parentCommentId, (counts.get(c.parentCommentId) ?? 0) + 1);
          }
        }
        return counts;
      },
      create: async (data: any) => {
        const id = '018d9f30-0000-7000-8000-000000000099';
        const rec = {
          ...data,
          id,
          likeCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        commentsStore.set(id, rec);
        return rec;
      },
      update: async (id: string, data: any) => {
        const c = commentsStore.get(id);
        if (!c) throw new Error('Not found');
        const updated = { ...c, ...data, updatedAt: new Date() };
        commentsStore.set(id, updated);
        return updated;
      },
      softDelete: async (id: string) => {
        const c = commentsStore.get(id);
        if (c) c.deletedAt = new Date();
      },
      incrementLikeCount: async (id: string, delta: number) => {
        const c = commentsStore.get(id);
        if (!c) throw new Error('Not found');
        c.likeCount = Math.max((c.likeCount ?? 0) + delta, 0);
        return c.likeCount;
      },
    };

    const mockCommentReactionRepo = {
      insertIfAbsent: async (commentId: string, userId: string, type: 'like' = 'like') => {
        const key = makeKey(commentId, userId);
        if (reactionStore.has(key)) return false;
        reactionStore.set(key, { commentId, userId, type });
        return true;
      },
      upsert: async (commentId: string, userId: string, type: 'like' = 'like') => {
        const rec = { commentId, userId, type };
        reactionStore.set(makeKey(commentId, userId), rec);
        return rec;
      },
      delete: async (commentId: string, userId: string) => {
        return reactionStore.delete(makeKey(commentId, userId));
      },
      findByCommentAndUser: async (commentId: string, userId: string) => {
        return reactionStore.get(makeKey(commentId, userId)) ?? null;
      },
      findLikedCommentIdsByUser: async (userId: string, commentIds: string[]) => {
        const set = new Set<string>();
        for (const cId of commentIds) {
          if (reactionStore.has(makeKey(cId, userId))) {
            set.add(cId);
          }
        }
        return set;
      },
      countByCommentId: async (commentId: string) => {
        let count = 0;
        for (const key of reactionStore.keys()) {
          if (key.startsWith(`${commentId}:`)) count++;
        }
        return count;
      },
    };

    const mockOutbox = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [
        FakePlatformModule,
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AccessModule,
        ContentModule,
      ],
    })
      .overrideProvider(ACCESS_STORE)
      .useValue(new MemoryAccessStore())
      .overrideProvider(ACTION_RATE_LIMITER)
      .useValue(new MemoryActionRateLimiter())
      .overrideProvider(LOGIN_RATE_LIMITER)
      .useValue(new MemoryLoginRateLimiter())
      .overrideProvider(ACCESS_SID_BLOCKLIST)
      .useValue(new MemorySidBlocklist())
      .overrideProvider(CONTENT_DB)
      .useValue({})
      .overrideProvider(MEDIA_ASSET_STORE)
      .useValue(new MemoryMediaAssetStore())
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new InMemoryObjectStorage({ keyPrefix: 'dev/test/', cdnBaseUrl: 'https://cdn.test' }))
      .overrideProvider(FEED_STORE)
      .useValue({
        listPlayablePosts: async () => [],
        findLikedPostIds: async () => [],
        findSavedPostIds: async () => [],
      })
      .overrideProvider(PostRepository)
      .useValue(mockPostRepo)
      .overrideProvider(CommentRepository)
      .useValue(mockCommentRepo)
      .overrideProvider(CommentReactionRepository)
      .useValue(mockCommentReactionRepo)
      .overrideProvider(CONTENT_OUTBOX)
      .useValue(mockOutbox)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();

    // Đăng ký 2 user test
    await seedLegacyAccount(app, {
      email: 'user-a@tripflix.vn',
      password: PASSWORD,
      displayName: 'User A',
    });
    const loginA = await http()
      .post('/api/auth/login')
      .send({
        email: 'user-a@tripflix.vn',
        password: PASSWORD,
      })
      .expect(200);
    userAToken = loginA.body.accessToken;

    await registerTestAccount(app, {
      email: 'user-b@tripflix.vn',
      password: PASSWORD,
      displayName: 'User B',
    });
    const loginB = await http()
      .post('/api/auth/login')
      .send({
        email: 'user-b@tripflix.vn',
        password: PASSWORD,
      })
      .expect(200);
    userBToken = loginB.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it.each(['/api/v1/posts', `/api/v1/posts/${validPostId}/publish`, `/api/v1/posts/${validPostId}/comments`])(
    'POST %s yêu cầu xác thực email',
    async (path) => {
      const response = await http().post(path).set(bearer(userAToken)).expect(403);
      expect(response.body).toMatchObject({ code: 'email_unverified' });
    },
  );

  it('PUT /api/v1/comments/:id/reaction không có token: 401 Unauthorized', async () => {
    await http().put(`/api/v1/comments/${validCommentId}/reaction`).expect(401);
  });

  it('PUT /api/v1/comments/:id/reaction với comment không tồn tại: 404 Not Found', async () => {
    await http()
      .put('/api/v1/comments/018d9f30-0000-7000-8000-999999999999/reaction')
      .set(bearer(userAToken))
      .expect(404);
  });

  it('User A thả tim (toggle lần đầu): 200 OK, isLiked=true, likeCount=1', async () => {
    const res = await http()
      .put(`/api/v1/comments/${validCommentId}/reaction`)
      .set(bearer(userAToken))
      .send({})
      .expect(200);

    expect(res.body).toEqual({
      commentId: validCommentId,
      isLiked: true,
      likeCount: 1,
    });
  });

  it('User A gửi lại type="like" (idempotent): likeCount vẫn là 1, isLiked=true', async () => {
    const res = await http()
      .put(`/api/v1/comments/${validCommentId}/reaction`)
      .set(bearer(userAToken))
      .send({ type: 'like' })
      .expect(200);

    expect(res.body).toEqual({
      commentId: validCommentId,
      isLiked: true,
      likeCount: 1,
    });
  });

  it('User B cũng thả tim: 200 OK, isLiked=true, likeCount=2', async () => {
    const res = await http()
      .put(`/api/v1/comments/${validCommentId}/reaction`)
      .set(bearer(userBToken))
      .send({ type: 'like' })
      .expect(200);

    expect(res.body).toEqual({
      commentId: validCommentId,
      isLiked: true,
      likeCount: 2,
    });
  });

  it('GET /api/v1/posts/:postId/comments với khách vãng lai (không token): likeCount=2, isLiked=false', async () => {
    const res = await http().get(`/api/v1/posts/${validPostId}/comments`).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: validCommentId,
      likeCount: 2,
      isLiked: false,
    });
  });

  it('GET /api/v1/posts/:postId/comments với User A (đã thả tim): likeCount=2, isLiked=true', async () => {
    const res = await http().get(`/api/v1/posts/${validPostId}/comments`).set(bearer(userAToken)).expect(200);

    expect(res.body.items[0]).toMatchObject({
      id: validCommentId,
      likeCount: 2,
      isLiked: true,
    });
  });

  it('focusCommentId chỉ trả lượt trả lời và bình luận cha còn hiển thị', async () => {
    const replyId = '018d9f30-0000-7000-8000-000000000002';
    const parent = commentsStore.get(validCommentId)!;
    commentsStore.set(replyId, { ...parent, id: replyId, parentCommentId: validCommentId });
    try {
      const getFocus = () => http().get(`/api/v1/posts/${validPostId}/comments`).query({ focusCommentId: replyId });
      const visible = await getFocus().expect(200);
      expect(visible.body).toMatchObject({
        items: [{ id: validCommentId }, { id: replyId, parentCommentId: validCommentId }],
        nextCursor: null,
      });
      commentsStore.set(validCommentId, { ...parent, status: 'hidden' });
      const hidden = await getFocus().expect(200);
      expect(hidden.body).toMatchObject({ items: [], nextCursor: null });
    } finally {
      commentsStore.set(validCommentId, parent);
      commentsStore.delete(replyId);
    }
  });

  it('User A hủy thả tim bằng type=null: 200 OK, isLiked=false, likeCount=1', async () => {
    const res = await http()
      .put(`/api/v1/comments/${validCommentId}/reaction`)
      .set(bearer(userAToken))
      .send({ type: null })
      .expect(200);

    expect(res.body).toEqual({
      commentId: validCommentId,
      isLiked: false,
      likeCount: 1,
    });
  });

  it('User B toggle bỏ thả tim: 200 OK, isLiked=false, likeCount=0', async () => {
    const res = await http()
      .put(`/api/v1/comments/${validCommentId}/reaction`)
      .set(bearer(userBToken))
      .send({})
      .expect(200);

    expect(res.body).toEqual({
      commentId: validCommentId,
      isLiked: false,
      likeCount: 0,
    });
  });
});
