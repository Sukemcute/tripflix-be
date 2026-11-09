import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  MODULES,
  buildDrizzleToken,
  buildTransactionHostToken,
  createDb,
  createPool,
  createTransactionalPlugins,
  type ModuleTransactionHost,
} from '@tripflix/db';
import { OutboxWriter } from '@tripflix/outbox';
import { migrateModule, startPostgres, type PostgresFixture } from '@tripflix/testing';
import { ClsModule } from 'nestjs-cls';
import type pg from 'pg';
import { contentOutboxEvents } from '../../db/schema/index.js';
import { PostRepository } from '../../social/infra/post.repository.js';
import { CommentRepository } from '../../social/infra/comment.repository.js';
import { PostSummaryRepository } from '../../social/infra/post-summary.repository.js';
import { ModerationActionRepository } from '../../social/infra/moderation-action.repository.js';
import { AdminModeratePostUseCase } from '../../social/application/use-cases/admin-moderate-post.use-case.js';
import { AddCommentUseCase } from '../../social/application/use-cases/add-comment.use-case.js';
import { DeleteCommentUseCase } from '../../social/application/use-cases/delete-comment.use-case.js';
import { GetPostSummaryUseCase } from '../../social/application/use-cases/get-post-summary.use-case.js';
import { SavePostSummaryUseCase } from '../../social/application/use-cases/save-post-summary.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { ChangeVisibilityUseCase } from './change-visibility.use-case.js';
import { DecideCaseUseCase, RecordScreeningUseCase, SubmitReportUseCase } from './moderation.use-cases.js';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const CONFIG = { aiThreshold: 0.8, reportThreshold: 3, allowedDomains: ['tripflix.vn'] };
describe('TF32 moderation: transaction Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let moduleRef: TestingModule;
  let postId: string;
  let failOutbox = false;
  function bundle(tx: ModuleTransactionHost) {
    const repository = new ModerationRepository(() => tx.tx);
    const posts = new PostRepository(() => tx.tx);
    const comments = new CommentRepository(() => tx.tx);
    const summaries = new PostSummaryRepository(() => tx.tx);
    const writer = new OutboxWriter(() => tx.tx, contentOutboxEvents, 'core-api/content');
    const outbox = {
      add: async (...args: Parameters<typeof writer.add>) => {
        if (failOutbox) throw new Error('outbox unavailable');
        return writer.add(...args);
      },
    };
    const moderate = new AdminModeratePostUseCase(posts, new ModerationActionRepository(() => tx.tx), outbox);
    const visibility = new ChangeVisibilityUseCase(repository, posts, outbox, moderate);
    return {
      repository,
      comments,
      summaries,
      visibility,
      moderate,
      report: new SubmitReportUseCase(repository, visibility, outbox, CONFIG),
      decide: new DecideCaseUseCase(repository, visibility),
      screen: new RecordScreeningUseCase(repository, visibility, CONFIG),
      add: new AddCommentUseCase(posts, comments, outbox),
      delete: new DeleteCommentUseCase(comments, posts, outbox),
      saveSummary: new SavePostSummaryUseCase(posts, summaries),
      getSummary: new GetPostSummaryUseCase(posts, summaries, comments),
    };
  }
  let cases: ReturnType<typeof bundle>;
  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 8, applicationName: 'tf32-moderation-test' });
    const db = createDb(pool);
    @Global()
    @Module({
      providers: MODULES.map((name) => ({ provide: buildDrizzleToken(name), useValue: db })),
      exports: MODULES.map(buildDrizzleToken),
    })
    class TestDrizzleModule {}
    moduleRef = await Test.createTestingModule({
      imports: [
        TestDrizzleModule,
        ClsModule.forRoot({ global: true, plugins: createTransactionalPlugins([TestDrizzleModule]) }),
      ],
      providers: [{ provide: 'cases', inject: [buildTransactionHostToken('content')], useFactory: bundle }],
    }).compile();
    await moduleRef.init();
    cases = moduleRef.get('cases');
  });
  beforeEach(async () => {
    failOutbox = false;
    await pool.query(
      'truncate content.posts, content.moderation_cases, content.reports, content.outbox_events, content.moderation_processed_events cascade',
    );
    postId = randomUUID();
    await pool.query(
      "insert into content.posts (id, author_id, post_type, title, status, published_at) values ($1,$2,'video','Bài sạch','published',now())",
      [postId, AUTHOR],
    );
  });
  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    await postgres?.stop();
  });
  const hide = (targetId: string, action: 'hide' | 'restore' | 'remove' = 'hide') =>
    cases.visibility.execute({
      targetType: 'comment',
      targetId,
      action,
      actorId: AUTHOR,
      actorType: 'staff',
      reasonCode: 'HARASSMENT',
    });
  const add = (parentCommentId?: string) =>
    cases.add.execute({ postId, authorId: AUTHOR, body: 'Bình luận', parentCommentId });
  async function count() {
    return (await pool.query('select comment_count from content.posts where id=$1', [postId])).rows[0]
      .comment_count;
  }

  it('ẩn gốc cascade, hidden riêng không được restore theo gốc; outbox mỗi dòng đổi', async () => {
    const root = await add();
    const child = await add(root.id);
    const separatelyHidden = await add(root.id);
    await hide(separatelyHidden.id);
    expect(await count()).toBe(2);
    await hide(root.id);
    expect(await count()).toBe(0);
    expect(await cases.comments.findByPostId({ postId, flat: true, limit: 200 })).toEqual([]);
    await hide(root.id, 'restore');
    expect(await count()).toBe(2);
    expect(
      (await cases.comments.findByPostId({ postId, flat: true, limit: 200 })).map((c) => c.id).sort(),
    ).toEqual([root.id, child.id].sort());
    const events = await pool.query(
      "select payload from content.outbox_events where type='content.comment.hidden'",
    );
    expect(events.rowCount).toBe(3);
  });
  it('quyết định ẩn riêng sau cascade ngăn khôi phục phản hồi', async () => {
    const root = await add();
    const child = await add(root.id);
    await hide(root.id);
    await hide(child.id);
    await hide(root.id, 'restore');
    expect(await count()).toBe(1);
    expect((await cases.comments.findById(child.id))?.status).toBe('hidden');
  });
  it('20 lệnh ẩn cùng lúc chỉ trừ một lần; xoá hidden không trừ lần nữa, không restore được', async () => {
    const root = await add();
    await Promise.all(Array.from({ length: 20 }, () => hide(root.id)));
    expect(await count()).toBe(0);
    await cases.delete.execute({ commentId: root.id, userId: AUTHOR });
    expect(await count()).toBe(0);
    await expect(hide(root.id, 'restore')).rejects.toThrow(/xoá/);
    expect(await count()).toBe(0);
  });
  it('ẩn đồng thời thêm reply không tạo bình luận mồ côi hoặc lệch counter', async () => {
    const root = await add();
    await Promise.allSettled([hide(root.id), add(root.id)]);
    expect(await count()).toBe(0);
    expect(await cases.comments.countByPostId(postId, { flat: true })).toBe(0);
  });
  it('outbox lỗi rollback status, counter và nhật ký kể cả transaction lồng', async () => {
    const root = await add();
    await add(root.id);
    failOutbox = true;
    await expect(hide(root.id)).rejects.toThrow('outbox unavailable');
    expect(await count()).toBe(2);
    expect((await cases.comments.findById(root.id))?.status).toBe('visible');
    expect((await pool.query('select * from content.moderation_actions')).rowCount).toBe(0);
    await expect(
      cases.moderate.execute({ postId, moderatorId: AUTHOR, action: 'hide', reasonCode: 'OTHER' }),
    ).rejects.toThrow();
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'published',
    );
  });
  it('báo cáo trùng không tăng số; người thứ ba tự ẩn; case đã đóng trả conflict', async () => {
    const command = { targetType: 'post' as const, targetId: postId, reporterId: AUTHOR, reasonCode: 'SCAM' };
    const first = await cases.report.execute(command);
    expect((await cases.report.execute(command)).id).toBe(first.id);
    await cases.report.execute({ ...command, reporterId: randomUUID() });
    await cases.report.execute({ ...command, reporterId: randomUUID() });
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'hidden',
    );
    const item = await cases.repository.findCase(first.caseId!);
    expect(item?.reportCount).toBe(3);
    await cases.decide.execute(item!.id, { actorId: AUTHOR, action: 'restore', reasonCode: 'OTHER' });
    await expect(
      cases.decide.execute(item!.id, { actorId: AUTHOR, action: 'hide', reasonCode: 'OTHER' }),
    ).rejects.toThrow(/đã được xử lý/);
  });
  it('regex scam tự ẩn dù AI lỗi; event lặp chỉ xử lý một lần; bản sạch không tạo case', async () => {
    const clean = await cases.repository.loadTarget('post', postId);
    await cases.screen.execute(randomUUID(), clean!, null);
    expect((await pool.query('select * from content.moderation_cases')).rowCount).toBe(0);
    await pool.query(
      "update content.posts set body='Chuyển khoản đặt cọc STK 012345678901 VCB', updated_at=now() where id=$1",
      [postId],
    );
    const snapshot = await cases.repository.loadTarget('post', postId);
    const eventId = randomUUID();
    await cases.screen.execute(eventId, snapshot!, null);
    await cases.screen.execute(eventId, snapshot!, null);
    expect((await pool.query('select * from content.moderation_cases')).rowCount).toBe(1);
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'hidden',
    );
    expect(
      (await pool.query("select * from content.moderation_actions where actor_type='system'")).rowCount,
    ).toBe(1);
  });
  it('source roundtrip: ngoài nguồn bị ẩn vẫn trả; nguồn bị ẩn giữ văn bản nhưng giữ metadata; bản cũ PUT về muộn không lộ', async () => {
    const source = await add();
    const outside = await add();
    const time = new Date('2026-11-09T00:00:00Z');
    await cases.saveSummary.execute({
      postId,
      summary: 'Tóm tắt có nguồn',
      keyTakeaways: ['Ý chính'],
      inputHash: 'hash',
      sourceCommentIds: [source.id],
      generatedAt: time,
    });
    await hide(outside.id);
    expect((await cases.getSummary.execute(postId))?.summary).toBe('Tóm tắt có nguồn');
    await hide(source.id);
    const withheld = await cases.getSummary.execute(postId);
    expect(withheld?.summary).toBeNull();
    expect(withheld?.keyTakeaways).toEqual([]);
    expect(withheld?.inputHash).toBe('hash');
    expect(withheld?.sourceCommentIds).toEqual([source.id]);
    await cases.saveSummary.execute({
      postId,
      summary: 'Lượt cũ về muộn',
      sourceCommentIds: [source.id],
      generatedAt: new Date(time.getTime() + 1000),
    });
    expect((await cases.getSummary.execute(postId))?.summary).toBeNull();
    await cases.saveSummary.execute({
      postId,
      summary: 'Bản mới không nguồn',
      sourceCommentIds: [],
      generatedAt: new Date(time.getTime() + 2000),
    });
    await cases.saveSummary.execute({
      postId,
      summary: 'Không được ghi đè cùng timestamp',
      sourceCommentIds: [source.id],
      generatedAt: new Date(time.getTime() + 2000),
    });
    expect((await cases.getSummary.execute(postId))?.summary).toBe('Bản mới không nguồn');
    expect((await cases.getSummary.execute(postId))?.sourceCommentIds).toEqual([]);
  });

  it('nguồn thiếu, đã xoá hoặc thuộc bài khác đều không được trả nội dung; legacy thiếu nguồn giữ metadata null', async () => {
    const source = await add();
    const time = new Date('2026-11-09T00:00:00Z');
    await cases.saveSummary.execute({ postId, summary: 'Bản legacy', generatedAt: time });
    await cases.delete.execute({ commentId: source.id, userId: AUTHOR });
    expect(await cases.getSummary.execute(postId)).toMatchObject({
      summary: null,
      sourceCommentIds: null,
      isStale: true,
    });
    for (const [index, sourceId] of [source.id, randomUUID()].entries()) {
      await cases.saveSummary.execute({
        postId,
        summary: 'Nguồn không còn tồn tại',
        sourceCommentIds: [sourceId],
        generatedAt: new Date(time.getTime() + (index + 1) * 1000),
      });
      expect((await cases.getSummary.execute(postId))?.summary).toBeNull();
    }
    const otherPost = randomUUID();
    const otherComment = randomUUID();
    await pool.query(
      "insert into content.posts (id,author_id,post_type,title,status) values ($1,$2,'video','Khác','published')",
      [otherPost, AUTHOR],
    );
    await pool.query("insert into content.comments (id,post_id,author_id,body) values ($1,$2,$3,'Khác')", [
      otherComment,
      otherPost,
      AUTHOR,
    ]);
    await cases.saveSummary.execute({
      postId,
      summary: 'Nguồn sai bài',
      sourceCommentIds: [otherComment],
      generatedAt: new Date(time.getTime() + 3000),
    });
    expect((await cases.getSummary.execute(postId))?.summary).toBeNull();
  });

  it('sự kiện screening cũ đến sau quyết định restore không được tự ẩn lại nội dung', async () => {
    await pool.query(
      "update content.posts set body='Chuyển khoản đặt cọc STK 012345678901 VCB' where id=$1",
      [postId],
    );
    await cases.moderate.execute({ postId, moderatorId: AUTHOR, action: 'hide', reasonCode: 'SCAM' });
    await cases.moderate.execute({ postId, moderatorId: AUTHOR, action: 'restore', reasonCode: 'OTHER' });
    const snapshot = await cases.repository.loadTarget('post', postId);
    await cases.screen.execute(randomUUID(), snapshot!, null, '2026-11-09T00:00:00Z');
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'published',
    );
    expect((await pool.query('select * from content.moderation_cases')).rowCount).toBe(0);
  });

  it('remove gốc xoá mềm cả phản hồi, chỉ trừ visible; dismiss đóng case và không đổi trạng thái', async () => {
    const root = await add(); const child = await add(root.id);
    await hide(child.id);
    const result = await hide(root.id, 'remove');
    expect(result.changedCount).toBe(2); expect(await count()).toBe(0);
    expect((await pool.query('select * from content.comments where deleted_at is not null')).rowCount).toBe(2);
    const report = await cases.report.execute({ targetType: 'post', targetId: postId, reporterId: AUTHOR, reasonCode: 'OTHER' });
    await cases.decide.execute(report.caseId!, { actorId: AUTHOR, action: 'dismiss', reasonCode: 'OTHER' });
    expect((await cases.repository.findCase(report.caseId!))?.status).toBe('resolved');
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe('published');
  });

  it('AI nguy hiểm tự ẩn bình luận; queue/detail đọc được đúng nguồn và evidence', async () => {
    const root = await add(); const snapshot = await cases.repository.loadTarget('comment', root.id);
    await cases.screen.execute(randomUUID(), snapshot!, { id: `comment:${root.id}`, flagged: true, categories: { 'self-harm/intent': true }, scores: { 'self-harm/intent': 0.99 }, model: 'omni-test' });
    expect(await count()).toBe(0);
    const queue = await cases.repository.queue({ source: 'ai', targetType: 'comment', status: 'pending', limit: 20, offset: 0 });
    expect(queue.total).toBe(1); expect(queue.items[0]?.isAutoHidden).toBe(true);
    const detail = await cases.repository.detail(queue.items[0]!);
    expect(detail.target?.status).toBe('hidden'); expect(detail.actions).toHaveLength(1);
    expect(detail.flags).toMatchObject({ ai: { model: 'omni-test' } });
  });
});
