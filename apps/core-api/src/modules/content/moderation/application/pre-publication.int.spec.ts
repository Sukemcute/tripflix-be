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
import { PublishPostUseCase } from '../../social/application/use-cases/publish-post.use-case.js';
import { UpdatePostUseCase } from '../../social/application/use-cases/update-post.use-case.js';
import { EditCommentUseCase } from '../../social/application/use-cases/edit-comment.use-case.js';
import { RulesContentGate } from './content-gate.js';
import { DeleteCommentUseCase } from '../../social/application/use-cases/delete-comment.use-case.js';
import { GetPostSummaryUseCase } from '../../social/application/use-cases/get-post-summary.use-case.js';
import { SavePostSummaryUseCase } from '../../social/application/use-cases/save-post-summary.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { ChangeVisibilityUseCase } from './change-visibility.use-case.js';
import { ClaimDeferredScansUseCase } from './recover-screening.use-case.js';
import { ScreeningConsumer } from '../consumers/screening.consumer.js';
import {
  DecideAppealUseCase,
  DecideCaseUseCase,
  RecordScreeningUseCase,
  ScreenContentUseCase,
  SubmitAppealUseCase,
  SubmitReportUseCase,
} from './moderation.use-cases.js';

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const CONFIG = { aiThreshold: 0.8, reportThreshold: 3, allowedDomains: ['tripflix.vn'] };
describe('TF91 giữ trước khi public trên Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let moduleRef: TestingModule;
  let postId: string;
  let failOutbox = false;
  function bundle(tx: ModuleTransactionHost) {
    const rulesGate = new RulesContentGate();
    const gate = { precheck: (text: string) => {
      expect(tx.isTransactionActive()).toBe(false);
      return rulesGate.precheck(text);
    } };
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
      recovery: new ClaimDeferredScansUseCase(repository),
      comments,
      summaries,
      visibility,
      moderate,
      report: new SubmitReportUseCase(repository, visibility, outbox, CONFIG),
      appeal: new SubmitAppealUseCase(repository),
      decideAppeal: new DecideAppealUseCase(repository, visibility, outbox),
      decide: new DecideCaseUseCase(repository, visibility),
      screen: new RecordScreeningUseCase(repository, visibility, CONFIG),
      add: new AddCommentUseCase(posts, comments, outbox, undefined, gate),
      publish: new PublishPostUseCase(posts, outbox, undefined, undefined, undefined, gate),
      update: new UpdatePostUseCase(posts, outbox, undefined, gate),
      edit: new EditCommentUseCase(comments, outbox, posts, gate),
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
    postId = randomUUID();
    await pool.query("insert into content.posts (id, author_id, post_type, title, body, status, published_at) values ($1,$2,'vlog','Bài sạch','Đà Lạt','published',now())", [postId, AUTHOR]);
  });
  afterAll(async () => { await moduleRef?.close(); await pool?.end(); await postgres?.stop(); });
  const threat = 'tao biết nhà mày ở đâu';
  const decide = (targetType: 'post' | 'comment', targetId: string, action: 'dismiss' | 'hide' | 'restore' | 'remove' = 'dismiss') => cases.visibility.execute({
    targetType, targetId, action, actorId: AUTHOR, actorType: 'staff', reasonCode: 'OTHER',
  });
  const count = async () => (await pool.query('select comment_count from content.posts where id=$1', [postId])).rows[0].comment_count;
  const events = async (type: string, id: string) => (await pool.query("select * from content.outbox_events where type=$1 and (payload->>'commentId'=$2 or payload->>'postId'=$2)", [type, id])).rows;

  it('giữ bình luận, không thông báo; dismiss đồng thời chỉ tăng và phát created một lần', async () => {
    const c = await cases.add.execute({ postId, authorId: AUTHOR, body: threat });
    expect(c.status).toBe('held'); expect(await count()).toBe(0);
    expect(await events('content.comment.created', c.id)).toHaveLength(0);
    expect(await events('content.comment.held', c.id)).toHaveLength(1);
    expect(await cases.comments.findByPostId({ postId, limit: 10 })).toHaveLength(0);
    expect(await cases.comments.findByPostId({ postId, limit: 10, viewerId: AUTHOR })).toHaveLength(1);
    expect(await cases.comments.sampleComments({ postId, size: 10 })).toHaveLength(0);
    await Promise.all([decide('comment', c.id), decide('comment', c.id)]);
    expect(await count()).toBe(1);
    expect(await events('content.comment.created', c.id)).toHaveLength(1);
  });

  it('sửa bình luận gốc vi phạm giữ cả reply, trừ bộ đếm; nhả chỉ phục hồi reply cùng lần', async () => {
    const c = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Đẹp' });
    const reply = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Đồng ý', parentCommentId: c.id });
    const edited = await cases.edit.execute({ commentId: c.id, userId: AUTHOR, body: threat });
    expect(edited.status).toBe('held'); expect(await count()).toBe(0);
    expect((await cases.comments.findById(reply.id))?.status).toBe('held');
    expect(await cases.comments.findByPostId({ postId, limit: 10, flat: true })).toHaveLength(0);
    await decide('comment', c.id);
    expect(await count()).toBe(2);
    await decide('comment', c.id);
    expect(await count()).toBe(2);
  });

  it('publish held chưa có publishedAt/event công khai; dismiss đặt thời gian nhả và phát published một lần', async () => {
    await pool.query("update content.posts set status='draft', body=$2, published_at=null where id=$1", [postId, threat]);
    const p = await cases.publish.execute({ postId, userId: AUTHOR });
    expect(p.status).toBe('held'); expect(p.publishedAt).toBeNull();
    expect(await events('content.post.published', postId)).toHaveLength(0);
    await Promise.all([decide('post', postId), decide('post', postId)]);
    const record = (await pool.query('select status, published_at from content.posts where id=$1', [postId])).rows[0];
    expect(record.status).toBe('published'); expect(record.published_at).toBeInstanceOf(Date);
    expect(await events('content.post.published', postId)).toHaveLength(1);
  });

  it('bản sửa bài đã đăng bị giữ vẫn phát updated để discovery gỡ', async () => {
    const p = await cases.update.execute({ postId, userId: AUTHOR, body: threat });
    expect(p.status).toBe('held');
    expect(await events('content.post.updated', postId)).toHaveLength(1);
    expect(await events('content.post.held', postId)).toHaveLength(1);
    const clean = await cases.update.execute({ postId, userId: AUTHOR, body: 'Nội dung sạch lại' });
    expect(clean.status).toBe('held');
  });

  it('held vẫn có hồ sơ khi AI lỗi; event giao lại không tự ẩn sau staff nhả', async () => {
    const c = await cases.add.execute({ postId, authorId: AUTHOR, body: threat });
    const eventId = randomUUID();
    const worker = new ScreenContentUseCase(cases.repository, { moderate: async () => { throw new Error('AI down'); } }, cases.screen, { getPlayback: async () => ({}) } as never);
    await expect(worker.execute(eventId, 'comment', c.id)).rejects.toThrow('AI down');
    const queued = await cases.repository.queue({ view: 'pending', limit: 100, offset: 0 });
    expect(JSON.stringify(queued)).toContain(c.id);
    expect((await cases.comments.findById(c.id))?.status).toBe('held');
    await decide('comment', c.id);
    await worker.execute(eventId, 'comment', c.id);
    expect((await cases.repository.scan(eventId))?.status).toBe('superseded');
    expect((await cases.comments.findById(c.id))?.status).toBe('visible');
  });

  it('held bị hide/remove không được dismiss nhả; parent chưa công khai thì không nhả reply', async () => {
    const c = await cases.add.execute({ postId, authorId: AUTHOR, body: threat });
    await decide('comment', c.id, 'hide');
    await decide('comment', c.id);
    expect((await cases.comments.findById(c.id))?.status).toBe('hidden'); expect(await count()).toBe(0);
    const held = await cases.add.execute({ postId, authorId: AUTHOR, body: threat });
    await decide('post', postId, 'hide');
    await expect(decide('comment', held.id)).rejects.toThrow();
    expect((await cases.comments.findById(held.id))?.status).toBe('held');
  });

  it('bài held bị ẩn rồi restore vẫn xuất bản lần đầu, không trở về draft', async () => {
    await pool.query("update content.posts set status='held', published_at=null where id=$1", [postId]);
    await expect(cases.add.execute({ postId, authorId: AUTHOR, body: 'Reply' })).rejects.toThrow();
    await decide('post', postId, 'hide');
    await decide('post', postId, 'restore');
    const record = (await pool.query('select status, published_at from content.posts where id=$1', [postId])).rows[0];
    expect(record.status).toBe('published'); expect(record.published_at).toBeInstanceOf(Date);
    expect(await events('content.post.published', postId)).toHaveLength(1);
  });

  it('outbox lỗi rollback cả held, bộ đếm và cascade', async () => {
    const c = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Đẹp' });
    failOutbox = true;
    await expect(cases.edit.execute({ commentId: c.id, userId: AUTHOR, body: threat })).rejects.toThrow('outbox unavailable');
    expect((await cases.comments.findById(c.id))?.status).toBe('visible'); expect(await count()).toBe(1);
  });
});
