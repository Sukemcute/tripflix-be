import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import { createNoOpTransactionalPlugins } from '@tripflix/db';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGlobalPrefix, buildOpenApiDocument } from '../../../../platform/http.js';
import type { CommentRecord, NewCommentRecord, PostRecord } from '../../db/schema/index.js';
import {
  AddCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  GetCommentStatsUseCase,
  ListCommentsUseCase,
  SampleCommentsUseCase,
  SetCommentReactionUseCase,
} from '../application/index.js';
import { CommentRepository } from '../infra/comment.repository.js';
import { PostRepository } from '../infra/post.repository.js';
import { CommentReactionRepository } from '../infra/comment-reaction.repository.js';
import { CommentsController } from './comments.controller.js';

const AUTHOR = '018d9f00-0000-7000-8000-000000000001';
const TAGGED = '018d9f00-0000-7000-8000-000000000002';
const OTHER = '018d9f00-0000-7000-8000-000000000003';
const POST = '018d9f20-0000-7000-8000-000000000001';
const mention = { userId: TAGGED, offset: 3, length: 3 };
const content = { body: '😀 @An xin chào', mentions: [mention] };

describe('TF25 E2E: tag qua HTTP, use case và repository bộ nhớ (không DB)', () => {
  let app: INestApplication;
  let post: PostRecord;
  const records = new Map<string, CommentRecord>();
  const outbox = { add: vi.fn(async () => randomUUID()) };
  const directory = { getDisplayNames: vi.fn(async (_ids: string[]) => new Map<string, string>()) };
  const counterDeltas = { addCommentDelta: vi.fn(async () => {}) };
  const gate = { precheck: vi.fn(() => ({ shouldHold: false })) };
  let busy = false;
  const postRepository = {
    findById: async () => ({ ...post }),
    findByIdForUpdate: async () => ({ ...post }),
    tryLockAndIncrementCounter: async () => {
      if (busy) return { status: 'busy' as const };
      post.commentCount++;
      return { status: 'locked' as const, post: { ...post } };
    },
    incrementCounter: async (_id: string, _field: string, delta: number) => (post.commentCount += delta),
  };
  const readable = (row: CommentRecord, viewerId?: string) =>
    row.status === 'visible' || row.authorId === viewerId;
  const commentRepository = {
    create: vi.fn(async (input: NewCommentRecord): Promise<CommentRecord> => {
      const row = {
        ...input,
        id: randomUUID(),
        parentCommentId: input.parentCommentId ?? null,
        status: input.status ?? 'visible',
        hiddenByActionId: null,
        cascadeRootCommentId: null,
        likeCount: 0,
        isEdited: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as CommentRecord;
      records.set(row.id, row);
      return structuredClone(row);
    }),
    findById: async (id: string) => structuredClone(records.get(id) ?? null),
    findByIdForUpdate: async (id: string) => structuredClone(records.get(id) ?? null),
    update: vi.fn(async (id: string, input: Partial<NewCommentRecord>): Promise<CommentRecord> => {
      const row = { ...records.get(id)!, ...input, updatedAt: new Date() } as CommentRecord;
      records.set(id, row);
      return structuredClone(row);
    }),
    findPage: async (options: { viewerId?: string }) =>
      Array.from(records.values())
        .filter((row) => readable(row, options.viewerId))
        .map((row) => ({ ...row, replyCount: 0, isLiked: false })),
    countByPostId: async (_id: string, options?: { viewerId?: string }) =>
      Array.from(records.values()).filter((row) => readable(row, options?.viewerId)).length,
    countRepliesByParentIds: async () => new Map<string, number>(),
    holdWithVisibleReplies: async (id: string) => {
      const row = records.get(id)!;
      records.set(id, { ...row, status: 'held' });
      return 1;
    },
  };
  const http = () => request(app.getHttpServer());
  const create = (input: object = content, actor = 'author') =>
    http().post(`/api/v1/posts/${POST}/comments`).auth(actor, { type: 'bearer' }).send(input);
  const edit = (id: string, input: object, actor = 'author') =>
    http().patch(`/api/v1/comments/${id}`).auth(actor, { type: 'bearer' }).send(input);

  beforeAll(async () => {
    const posts = postRepository as unknown as PostRepository;
    const comments = commentRepository as unknown as CommentRepository;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({ global: true, plugins: createNoOpTransactionalPlugins() }),
        AuthModule.forRootAsync({
          useFactory: () => ({
            blocklist: new MemorySidBlocklist(),
            verifier: async (token: string) => {
              if (!['author', 'other', 'unverified'].includes(token)) throw new InvalidAccessTokenError();
              return {
                userId: token === 'other' ? OTHER : AUTHOR,
                role: 'member' as const,
                sid: token,
                exp: 9_999_999_999,
                emailVerified: token !== 'unverified',
              };
            },
          }),
        }),
      ],
      controllers: [CommentsController],
      providers: [
        {
          provide: AddCommentUseCase,
          useValue: new AddCommentUseCase(posts, comments, outbox, directory, gate, counterDeltas as never),
        },
        {
          provide: EditCommentUseCase,
          useValue: new EditCommentUseCase(comments, outbox, posts, gate, directory),
        },
        {
          provide: ListCommentsUseCase,
          useValue: new ListCommentsUseCase(posts, comments, undefined, directory),
        },
        ...[
          DeleteCommentUseCase,
          SetCommentReactionUseCase,
          SampleCommentsUseCase,
          GetCommentStatsUseCase,
        ].map((provide) => ({ provide, useValue: {} })),
        { provide: CommentReactionRepository, useValue: { findByCommentAndUser: async () => null } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyGlobalPrefix(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    records.clear();
    busy = false;
    post = {
      id: POST,
      authorId: OTHER,
      postType: 'vlog',
      status: 'published',
      visibility: 'public',
      isVerified: false,
      title: 'Test',
      body: 'Test',
      hashtags: [],
      mediaIds: [],
      coverMediaId: null,
      tripAttachment: null,
      reactionCounts: {},
      reactionTotal: 0,
      commentCount: 0,
      shareCount: 0,
      bookmarkCount: 0,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      commentsEnabled: true,
      commentKeywords: [],
    };
    directory.getDisplayNames
      .mockReset()
      .mockImplementation(
        async (ids) =>
          new Map(ids.filter((id) => [AUTHOR, TAGGED, OTHER].includes(id)).map((id) => [id, 'Tên hiển thị'])),
      );
    gate.precheck.mockReturnValue({ shouldHold: false });
  });

  it('tạo/list trả mentions và giữ field response cũ; trim cập nhật offset', async () => {
    const created = await create({
      body: `  ${content.body}  `,
      mentions: [{ ...mention, offset: 5 }],
    }).expect(201);
    expect(created.body).toMatchObject({
      ...content,
      postId: POST,
      authorId: AUTHOR,
      likeCount: 0,
      isLiked: false,
    });
    expect(records.get(created.body.id)?.mentions).toEqual(content.mentions);
    expect(post.commentCount).toBe(1);
    expect(outbox.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content.comment.created',
        payload: expect.objectContaining({ mentionedUserIds: [TAGGED] }),
      }),
    );
    const list = await http().get(`/api/v1/posts/${POST}/comments`).expect(200);
    expect(list.body.items[0]).toMatchObject(content);
  });

  it('client cũ không gửi mentions và bản ghi legacy đều nhận []', async () => {
    const created = await create({ body: '@An là chữ thường', parent_comment_id: null }).expect(201);
    expect(created.body.mentions).toEqual([]);
    delete records.get(created.body.id)!.mentions;
    const list = await http().get(`/api/v1/posts/${POST}/comments`).expect(200);
    expect(list.body.items[0].mentions).toEqual([]);
  });

  it.each([
    null,
    {},
    [{ ...mention, userId: 'invalid' }],
    [{ ...mention, offset: '3' }],
    [{ ...mention, offset: -1 }],
    [{ ...mention, length: 999 }],
    [{ ...mention, offset: 0 }],
    [mention, mention],
    Array.from({ length: 11 }, () => mention),
  ])('từ chối mentions không hợp lệ bằng 400, không ghi: %j', async (mentions) => {
    await create({ body: content.body, mentions }).expect(400);
    expect(commentRepository.create).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('user không tồn tại: 400; directory lỗi: 500; cả hai không ghi', async () => {
    await create({ ...content, mentions: [{ ...mention, userId: randomUUID() }] }).expect(400);
    directory.getDisplayNames.mockRejectedValueOnce(new Error('Directory unavailable'));
    await create().expect(500);
    expect(commentRepository.create).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('edit thiếu mentions giữ và kiểm lại; [] bỏ tag; thay tag tường minh', async () => {
    const created = await create().expect(201);
    const id = created.body.id;
    const kept = await edit(id, { body: '😀 @An rất vui' }).expect(200);
    expect(kept.body.mentions).toEqual(content.mentions);
    await edit(id, { body: 'Xin chào' }).expect(400);
    expect(records.get(id)?.body).toBe('😀 @An rất vui');
    const removed = await edit(id, { body: 'Xin chào', mentions: [] }).expect(200);
    expect(removed.body.mentions).toEqual([]);
    const replaced = await edit(id, {
      body: '@Bé',
      mentions: [{ userId: OTHER, offset: 0, length: 3 }],
    }).expect(200);
    expect(replaced.body.mentions).toEqual([{ userId: OTHER, offset: 0, length: 3 }]);
  });

  it('edit thiếu mentions vẫn kiểm lại user cũ và không ghi khi user đã mất', async () => {
    const created = await create().expect(201);
    directory.getDisplayNames.mockResolvedValueOnce(new Map());
    await edit(created.body.id, { body: '😀 @An rất vui' }).expect(400);
    expect(commentRepository.update).not.toHaveBeenCalled();
  });

  it('thay đổi mentions trong lúc tra directory trả 409, không ghi đè', async () => {
    const created = await create().expect(201);
    directory.getDisplayNames.mockImplementationOnce(async () => {
      const row = records.get(created.body.id)!;
      records.set(row.id, { ...row, mentions: [{ ...mention, userId: OTHER }] });
      return new Map([[TAGGED, 'An']]);
    });
    await edit(created.body.id, { body: '😀 @An rất vui' }).expect(409);
    expect(commentRepository.update).not.toHaveBeenCalled();
    expect(records.get(created.body.id)?.mentions?.[0]?.userId).toBe(OTHER);
  });

  it('chặn thiếu đăng nhập, email chưa xác thực và sửa tag của người khác', async () => {
    await http().post(`/api/v1/posts/${POST}/comments`).send(content).expect(401);
    await create(content, 'unverified').expect(403);
    const created = await create().expect(201);
    await edit(created.body.id, { body: 'Đổi tag', mentions: [] }, 'other').expect(403);
    expect(commentRepository.update).not.toHaveBeenCalled();
  });

  it('reply vẫn lưu mentions và giữ parent_comment_id cũ', async () => {
    const root = await create({ body: 'Gốc' }).expect(201);
    const reply = await create({ ...content, parent_comment_id: root.body.id }).expect(201);
    expect(reply.body).toMatchObject({ ...content, parentCommentId: root.body.id });
  });

  it.each(['creator', 'platform', 'busy'] as const)(
    'giữ tag khi held (%s), không cộng đếm public/delta',
    async (mode) => {
      if (mode !== 'platform') post.commentKeywords = ['xin chào'];
      else gate.precheck.mockReturnValue({ shouldHold: true });
      busy = mode === 'busy';
      const created = await create().expect(201);
      expect(created.body).toMatchObject({ status: 'held', mentions: content.mentions });
      expect(post.commentCount).toBe(0);
      expect(counterDeltas.addCommentDelta).not.toHaveBeenCalled();
      expect(outbox.add).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'content.comment.held' }));
      const publicList = await http().get(`/api/v1/posts/${POST}/comments`).expect(200);
      expect(publicList.body.items).toEqual([]);
      const ownList = await http()
        .get(`/api/v1/posts/${POST}/comments`)
        .auth('author', { type: 'bearer' })
        .expect(200);
      expect(ownList.body.items[0].mentions).toEqual(content.mentions);
    },
  );

  it.each(['hidden', 'removed'] as const)(
    'che mentions cùng body khi %s và trong focus thread',
    async (status) => {
      const created = await create().expect(201);
      records.get(created.body.id)!.status = status;
      for (const query of [{}, { focusCommentId: created.body.id }]) {
        const list = await http()
          .get(`/api/v1/posts/${POST}/comments`)
          .query(query)
          .auth('author', { type: 'bearer' })
          .expect(200);
        expect(list.body.items[0]).toMatchObject({ body: '', mentions: [], moderationState: 'hidden' });
      }
    },
  );

  it('OpenAPI mô tả mentions optional ở request, required ở response, UTF-16 ở offset', () => {
    const schemas = buildOpenApiDocument(app).components!.schemas!;
    const created = schemas.CreateCommentDto as { properties: Record<string, unknown>; required: string[] };
    expect(created.properties.mentions).toBeDefined();
    expect(created.required).toContain('body');
    expect(created.required).not.toContain('mentions');
    expect((schemas.SocialCommentDto as { required: string[] }).required).toContain('mentions');
    expect(JSON.stringify(schemas.CommentMentionDto)).toContain('UTF-16');
  });
});
