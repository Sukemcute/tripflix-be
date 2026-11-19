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
import { EditCommentUseCase } from '../../social/application/use-cases/edit-comment.use-case.js';
import { CommentControlsUseCases } from '../../social/application/comment-controls.use-cases.js';
import { GetPostSummaryUseCase } from '../../social/application/use-cases/get-post-summary.use-case.js';
import { SavePostSummaryUseCase } from '../../social/application/use-cases/save-post-summary.use-case.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { ChangeVisibilityUseCase } from './change-visibility.use-case.js';
import { ReviewQueueUseCase } from './review-queue.use-case.js';
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
describe('TF32 moderation: transaction Postgres thật', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let moduleRef: TestingModule;
  let postId: string;
  let failOutbox = false;
  const displayNames = new Map<string, string>();
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
      review: new ReviewQueueUseCase(repository),
      recovery: new ClaimDeferredScansUseCase(repository, outbox),
      comments,
      controls: new CommentControlsUseCases(() => tx.tx, outbox),
      summaries,
      visibility,
      moderate,
      report: new SubmitReportUseCase(repository, visibility, outbox, CONFIG),
      appeal: new SubmitAppealUseCase(repository, outbox),
      decideAppeal: new DecideAppealUseCase(repository, visibility, outbox),
      decide: new DecideCaseUseCase(repository, visibility),
      screen: new RecordScreeningUseCase(repository, visibility, CONFIG, outbox),
      add: new AddCommentUseCase(posts, comments, outbox, { getDisplayNames: async () => displayNames }),
      delete: new DeleteCommentUseCase(comments, posts, outbox),
      edit: new EditCommentUseCase(comments, outbox, posts),
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
    displayNames.clear();
    failOutbox = false;
    await pool.query(
      'truncate content.posts, content.moderation_cases, content.reports, content.outbox_events, content.moderation_processed_events, content.moderation_scans cascade',
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

  async function reviewCase(): Promise<string> {
    const report = await cases.report.execute({
      targetType: 'post',
      targetId: postId,
      reporterId: randomUUID(),
      reasonCode: 'OTHER',
    });
    if (!report.caseId) throw new Error('QA report must create a moderation case');
    return report.caseId;
  }
  it('BE10: hai Admin nhận cùng hồ sơ chỉ một người thành công; người khác không duyệt hoặc lách API trực tiếp', async () => {
    const id = await reviewCase(),
      a = randomUUID(),
      b = randomUUID();
    const results = await Promise.allSettled([
      cases.review.execute(id, a, 'claim'),
      cases.review.execute(id, b, 'claim'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const item = (await cases.repository.findCase(id))!;
    const other = item.assigneeId === a ? b : a;
    await expect(
      cases.decide.execute(id, { actorId: other, action: 'hide', reasonCode: 'OTHER' }),
    ).rejects.toThrow('Hồ sơ');
    await expect(
      cases.moderate.execute({ postId, moderatorId: other, action: 'hide', reasonCode: 'OTHER' }),
    ).rejects.toThrow('Hồ sơ');
    await expect(
      cases.visibility.execute({
        targetType: 'post',
        targetId: postId,
        actorType: 'staff',
        actorId: other,
        action: 'hide',
        reasonCode: 'OTHER',
      }),
    ).rejects.toThrow('Hồ sơ');
    expect((await cases.repository.findCase(id))?.status).toBe('pending');
  });
  it('BE10: nhận lặp không tạo audit trùng, gia hạn không lùi dueAt; trả và nhận lại đổi mã phiên', async () => {
    const id = await reviewCase(),
      a = randomUUID();
    const first = await cases.review.execute(id, a, 'claim');
    expect((await cases.review.execute(id, a, 'claim')).leaseId).toBe(first.leaseId);
    const renewed = await cases.review.execute(id, a, 'renew', first.leaseId!);
    expect(renewed.dueAt).toEqual(first.dueAt);
    await expect(cases.review.execute(id, a, 'release', randomUUID())).rejects.toThrow('Phiên');
    await cases.review.execute(id, a, 'release', first.leaseId!);
    const second = await cases.review.execute(id, a, 'claim');
    expect(second.leaseId).not.toBe(first.leaseId);
    await expect(
      cases.decide.execute(id, {
        actorId: a,
        action: 'dismiss',
        reasonCode: 'OTHER',
        leaseId: first.leaseId!,
      }),
    ).rejects.toThrow('Hồ sơ');
    const detail = await cases.repository.detail(second);
    expect(detail.reviewAudit.filter((row) => row.action === 'claim')).toHaveLength(2);
  });
  it('BE10: hết hạn có thể nhận lại; phiên cũ không được gia hạn/trả/duyệt, quyết định vẫn chỉ ghi một lần', async () => {
    const id = await reviewCase(),
      a = randomUUID(),
      b = randomUUID();
    const first = await cases.review.execute(id, a, 'claim');
    await pool.query(
      "update content.moderation_cases set lease_expires_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await expect(cases.review.execute(id, a, 'renew', first.leaseId!)).rejects.toThrow('Phiên');
    await expect(
      cases.decide.execute(id, {
        actorId: a,
        action: 'dismiss',
        reasonCode: 'OTHER',
        leaseId: first.leaseId!,
      }),
    ).rejects.toThrow('Hồ sơ');
    const next = await cases.review.execute(id, b, 'claim');
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        cases.decide.execute(id, {
          actorId: b,
          action: 'dismiss',
          reasonCode: 'OTHER',
          leaseId: next.leaseId!,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await cases.repository.findCase(id))?.assigneeId).toBeNull();
    await expect(cases.review.execute(id, a, 'claim')).rejects.toThrow('đã được xử lý');
  });
  it('BE10: bộ lọc và aggregate đếm đầy đủ hơn 100 hồ sơ, tìm kiếm ở server và audit xem bằng chứng', async () => {
    await pool.query(
      "insert into content.comments(post_id,author_id,body) select $1,$2,'Nội dung '||n from generate_series(1,125)n",
      [postId, AUTHOR],
    );
    await pool.query(
      "insert into content.moderation_cases(target_type,target_id,post_id,author_id,severity,due_at) select 'comment',id,post_id,author_id,50,now()-interval '1 hour' from content.comments where post_id=$1",
      [postId],
    );
    const stats = await cases.repository.stats(80, AUTHOR);
    expect(stats).toMatchObject({ pendingTotal: 125, unassigned: 125, overdue: 125, assignedToMe: 0 });
    const page = await cases.repository.queue({
      view: 'pending',
      assignment: 'unassigned',
      sla: 'overdue',
      actorId: AUTHOR,
      limit: 20,
      offset: 0,
    });
    expect(page.total).toBe(125);
    expect(page.items).toHaveLength(20);
    const item = page.items[0]!;
    const original = await cases.repository.queue({
      view: 'pending',
      assignment: 'unassigned',
      actorId: AUTHOR,
      limit: 100,
      offset: 0,
    });
    await cases.review.execute(item.id, AUTHOR, 'claim');
    const nextPage = await cases.repository.queue({
      view: 'pending',
      assignment: 'unassigned',
      actorId: AUTHOR,
      limit: 20,
      offset: 0,
      cursor: page.nextCursor!,
    });
    expect(nextPage.items.map((row) => row.id)).toEqual(original.items.slice(20, 40).map((row) => row.id));
    await expect(
      cases.repository.queue({ view: 'pending', limit: 20, offset: 0, cursor: 'invalid' }),
    ).rejects.toThrow('Cursor');
    const mine = await cases.repository.queue({
      view: 'pending',
      assignment: 'mine',
      actorId: AUTHOR,
      limit: 20,
      offset: 0,
    });
    expect(mine.total).toBe(1);
    expect((await cases.repository.stats(80, AUTHOR)).unassigned).toBe(124);
    const search = await cases.repository.queue({
      view: 'pending',
      search: 'Nội dung 125',
      limit: 20,
      offset: 0,
    });
    expect(search.total).toBe(1);
    await cases.review.recordEvidenceView(item.id, AUTHOR);
    expect((await cases.repository.detail(item)).reviewAudit).toContainEqual(
      expect.objectContaining({ actorId: AUTHOR, action: 'evidence_view' }),
    );
  });
  it('BE10: tăng ưu tiên rút ngắn SLA từ lúc tạo, report mới không lùi deadline', async () => {
    const id = await reviewCase();
    await pool.query("update content.moderation_cases set created_at=now()-interval '2 hours' where id=$1", [
      id,
    ]);
    const target = (await cases.repository.loadTarget('post', postId))!;
    const updated = await cases.repository.upsertCase(target, {
      sources: ['rule'],
      severity: 90,
      flags: {},
      reportCount: 1,
    });
    expect(updated.dueAt.getTime()).toBe(updated.createdAt.getTime() + 3600000);
    const again = await cases.repository.upsertCase(target, {
      sources: ['report'],
      severity: 5,
      flags: {},
      reportCount: 2,
    });
    expect(again.dueAt).toEqual(updated.dueAt);
    expect((await cases.repository.stats(80)).overdue).toBe(1);
  });

  it('ngữ cảnh chi tiết: đúng bài chứa comment, đúng đích trả lời và fallback luồng cho dữ liệu cũ', async () => {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    await pool.query(
      "update content.posts set title='Bài nguồn QA',body='Nội dung bài nguồn QA' where id=$1",
      [postId],
    );
    const root = await cases.add.execute({ postId, authorId: a, body: 'Gốc A' });
    const parent = await cases.add.execute({ postId, authorId: b, body: 'Đích B', parentCommentId: root.id });
    const reply = await cases.add.execute({
      postId,
      authorId: c,
      body: 'Trả lời C',
      parentCommentId: parent.id,
    });
    const report = await cases.report.execute({
      targetType: 'comment',
      targetId: reply.id,
      reporterId: randomUUID(),
      reasonCode: 'OTHER',
    });
    const item = (await cases.repository.findCase(report.caseId!))!;
    const detail = await cases.repository.detail(item);
    expect(detail.postContext).toMatchObject({
      id: postId,
      authorId: AUTHOR,
      title: 'Bài nguồn QA',
      excerpt: 'Nội dung bài nguồn QA',
      status: 'published',
      visibility: 'public',
      unavailable: false,
    });
    expect(detail.parentComment).toMatchObject({ id: parent.id, authorId: b, body: 'Đích B', kind: 'reply' });
    await pool.query('update content.comments set reply_to_comment_id=null where id=$1', [reply.id]);
    expect((await cases.repository.detail(item)).parentComment).toMatchObject({
      id: root.id,
      authorId: a,
      kind: 'thread',
    });
    await pool.query('update content.comments set deleted_at=now() where id=$1', [root.id]);
    expect((await cases.repository.detail(item)).parentComment).toMatchObject({
      body: null,
      unavailable: true,
    });
    await pool.query("update content.posts set deleted_at=now(),status='deleted' where id=$1", [postId]);
    expect((await cases.repository.detail(item)).postContext).toMatchObject({
      id: postId,
      title: null,
      excerpt: null,
      unavailable: true,
    });
  });
  it('ngữ cảnh chi tiết không lấy bình luận của bài khác khi dữ liệu reply bị sai', async () => {
    const comment = await add();
    const report = await cases.report.execute({
      targetType: 'comment',
      targetId: comment.id,
      reporterId: randomUUID(),
      reasonCode: 'OTHER',
    });
    const otherPost = randomUUID(),
      foreign = randomUUID();
    await pool.query(
      "insert into content.posts(id,author_id,post_type,title,status) values($1,$2,'vlog','Bài khác','published')",
      [otherPost, AUTHOR],
    );
    await pool.query(
      "insert into content.comments(id,post_id,author_id,body) values($1,$2,$3,'Nội dung của bài khác')",
      [foreign, otherPost, AUTHOR],
    );
    await pool.query('update content.comments set reply_to_comment_id=$1 where id=$2', [foreign, comment.id]);
    const detail = await cases.repository.detail((await cases.repository.findCase(report.caseId!))!);
    expect(detail.parentComment).toBeNull();
    expect(detail.postContext?.id).toBe(postId);
  });

  it('chủ bài bật/tắt bình luận và người khác không được đổi cài đặt hoặc xem hàng chờ', async () => {
    const member = randomUUID();
    await expect(
      cases.controls.updateSettings(postId, member, { enabled: false, keywords: [] }),
    ).rejects.toThrow('Chỉ chủ bài');
    await expect(cases.controls.queue(postId, member, 0, 20)).rejects.toThrow('Chỉ chủ bài');
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: false, keywords: ['đặt cọc'] });
    await expect(cases.add.execute({ postId, authorId: member, body: 'Bình thường' })).rejects.toThrow(
      'Chủ bài đã tắt',
    );
    expect((await cases.controls.permissions(postId)).enabled).toBe(false);
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: [] });
    expect((await cases.controls.permissions(postId)).enabled).toBe(true);
  });

  it('keyword giữ bình luận, không đếm public; duyệt lặp chỉ công khai và phát created đúng một lần', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['đặt cọc'] });
    const held = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Xin ĐẶT CỌC trước nhé' });
    expect(held).toMatchObject({ status: 'held', creatorReview: 'pending', platformHeld: false });
    expect(
      (await pool.query('select comment_count from content.posts where id=$1', [postId])).rows[0]
        .comment_count,
    ).toBe(0);
    expect((await cases.controls.queue(postId, AUTHOR, 0, 1)).items[0]?.id).toBe(held.id);
    await Promise.all([
      cases.controls.decide(held.id, AUTHOR, 'approve'),
      cases.controls.decide(held.id, AUTHOR, 'approve'),
    ]);
    expect((await cases.comments.findById(held.id))?.status).toBe('visible');
    expect(
      (await pool.query('select comment_count from content.posts where id=$1', [postId])).rows[0]
        .comment_count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select id from content.outbox_events where type='content.comment.created' and payload->>'commentId'=$1",
          [held.id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('creator approve không vượt platform hold; platform restore không vượt creator reject', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Cần lọc bình luận này' });
    await pool.query('update content.comments set platform_held=true where id=$1', [held.id]);
    await cases.controls.decide(held.id, AUTHOR, 'approve');
    expect((await cases.comments.findById(held.id))?.status).toBe('held');
    await hide(held.id, 'restore');
    expect((await cases.comments.findById(held.id))?.status).toBe('visible');
    const rejected = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Cần lọc tiếp' });
    await cases.controls.decide(rejected.id, AUTHOR, 'reject');
    await hide(rejected.id);
    await hide(rejected.id, 'restore');
    expect(await cases.comments.findById(rejected.id)).toMatchObject({
      status: 'held',
      creatorReview: 'rejected',
    });
  });

  it.each(['creator', 'platform'] as const)(
    'nhả held qua %s giữ đúng người được trả lời cấp 2 và tên tác giả',
    async (release) => {
      const rootAuthor = randomUUID();
      const replyAuthor = randomUUID();
      const writer = randomUUID();
      displayNames.set(writer, 'Người trả lời C');
      const root = await cases.add.execute({ postId, authorId: rootAuthor, body: 'Gốc A' });
      const reply = await cases.add.execute({
        postId,
        authorId: replyAuthor,
        parentCommentId: root.id,
        body: 'Phản hồi B',
      });
      await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
      const held = await cases.add.execute({
        postId,
        authorId: writer,
        parentCommentId: reply.id,
        body: 'Cần lọc C',
      });
      if (release === 'creator') await cases.controls.decide(held.id, AUTHOR, 'approve');
      else {
        await pool.query(
          "update content.comments set creator_review='approved', platform_held=true where id=$1",
          [held.id],
        );
        await hide(held.id, 'restore');
      }
      const events = await pool.query(
        "select payload from content.outbox_events where type='content.comment.created' and payload->>'commentId'=$1",
        [held.id],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].payload).toMatchObject({
        parentCommentId: root.id,
        parentCommentAuthorId: rootAuthor,
        replyToCommentId: reply.id,
        replyToAuthorId: replyAuthor,
        authorDisplayName: 'Người trả lời C',
      });
    },
  );

  it('đổi settings không tự nhả bình luận đã giữ; quyết định creator rollback nếu outbox lỗi', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Cần lọc tiếp' });
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: [] });
    expect((await cases.comments.findById(held.id))?.status).toBe('held');
    failOutbox = true;
    await expect(cases.controls.decide(held.id, AUTHOR, 'approve')).rejects.toThrow('outbox unavailable');
    expect(await cases.comments.findById(held.id)).toMatchObject({
      status: 'held',
      creatorReview: 'pending',
    });
  });

  it('từ chối lặp không đổi đếm; người khác không được duyệt; tác giả xóa thì rời hàng chờ', async () => {
    const member = randomUUID();
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({ postId, authorId: member, body: 'Cần lọc' });
    await expect(cases.controls.decide(held.id, member, 'approve')).rejects.toThrow('Chỉ chủ bài');
    await cases.controls.decide(held.id, AUTHOR, 'reject');
    await cases.controls.decide(held.id, AUTHOR, 'reject');
    await expect(cases.controls.decide(held.id, AUTHOR, 'approve')).rejects.toThrow('đã được xử lý');
    expect(await count()).toBe(0);
    const pending = await cases.add.execute({ postId, authorId: member, body: 'Cần lọc tiếp' });
    await cases.delete.execute({ commentId: pending.id, userId: member });
    expect((await cases.controls.queue(postId, AUTHOR, 0, 20)).items).toHaveLength(0);
    await expect(cases.controls.decide(pending.id, AUTHOR, 'approve')).rejects.toThrow('Không tìm thấy');
    expect(await count()).toBe(0);
  });

  it('không tự nhả khi sửa bỏ keyword; chủ bài được bỏ qua bộ lọc của chính mình', async () => {
    const member = randomUUID();
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const own = await cases.add.execute({ postId, authorId: AUTHOR, body: 'lọc' });
    expect(own.status).toBe('visible');
    const held = await cases.add.execute({ postId, authorId: member, body: 'Cần lọc' });
    await cases.edit.execute({ commentId: held.id, userId: member, body: 'Đã sửa sạch' });
    expect(await cases.comments.findById(held.id)).toMatchObject({
      status: 'held',
      creatorReview: 'pending',
    });
    await cases.controls.decide(held.id, AUTHOR, 'approve');
    expect(await count()).toBe(2);
  });

  it('hàng chờ phân trang và không lộ cài đặt bài riêng tư khi tắt bình luận', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    for (let i = 0; i < 3; i++)
      await cases.add.execute({ postId, authorId: randomUUID(), body: `Cần lọc ${i}` });
    const first = await cases.controls.queue(postId, AUTHOR, 0, 2);
    const next = await cases.controls.queue(postId, AUTHOR, first.nextCursor ?? undefined, 2);
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(3);
    expect(next.nextCursor).toBeNull();
    await pool.query("update content.posts set visibility='private', comments_enabled=false where id=$1", [
      postId,
    ]);
    await expect(cases.controls.permissions(postId)).rejects.toThrow('Không tìm thấy');
    await expect(cases.add.execute({ postId, authorId: randomUUID(), body: 'Bình thường' })).rejects.toThrow(
      'Không tìm thấy',
    );
  });

  it('hàng chờ không bỏ sót khi trang trước đã duyệt và có bình luận mới chen vào', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const original = [];
    for (let i = 0; i < 5; i++)
      original.push(await cases.add.execute({ postId, authorId: randomUUID(), body: `lọc ${i}` }));
    const first = await cases.controls.queue(postId, AUTHOR, undefined, 2);
    for (const row of first.items) await cases.controls.decide(row.id, AUTHOR, 'approve');
    await cases.add.execute({ postId, authorId: randomUUID(), body: 'lọc mới' });
    const second = await cases.controls.queue(postId, AUTHOR, first.nextCursor!, 2);
    const third = await cases.controls.queue(postId, AUTHOR, second.nextCursor!, 2);
    expect(new Set([...first.items, ...second.items, ...third.items].map((row) => row.id))).toEqual(
      new Set(original.map((row) => row.id)),
    );
    expect(third.nextCursor).toBeNull();
    await expect(cases.controls.queue(postId, AUTHOR, 'khong-hop-le', 2)).rejects.toThrow('Cursor');
  });

  it('hàng chờ trả đúng ngữ cảnh reply, che nội dung bị ẩn và chặn approve khi gốc chưa hiển thị', async () => {
    const root = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Gốc A' });
    const reply = await cases.add.execute({
      postId,
      authorId: randomUUID(),
      parentCommentId: root.id,
      body: 'Nội dung B',
    });
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({
      postId,
      authorId: randomUUID(),
      parentCommentId: reply.id,
      body: 'lọc C',
    });
    let row = (await cases.controls.queue(postId, AUTHOR, 0, 20)).items[0]!;
    expect(row).toMatchObject({
      canApprove: true,
      willPublish: true,
      parentContext: { id: reply.id, kind: 'reply', body: 'Nội dung B', unavailable: false },
    });
    await hide(reply.id);
    row = (await cases.controls.queue(postId, AUTHOR, 0, 20)).items[0]!;
    expect(row.parentContext).toMatchObject({ body: null, unavailable: true });
    await hide(root.id);
    row = (await cases.controls.queue(postId, AUTHOR, 0, 20)).items[0]!;
    expect(row).toMatchObject({
      canApprove: false,
      willPublish: false,
      approvalBlockReason: 'parent_unavailable',
    });
    await expect(cases.controls.decide(held.id, AUTHOR, 'approve')).rejects.toThrow('gốc chưa hiển thị');
    expect((await cases.comments.findById(held.id))?.creatorReview).toBe('pending');
  });

  it('capability phân biệt chấp nhận bộ lọc với công khai và không duyệt vào trạng thái mắc kẹt khi bài bị giữ', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({ postId, authorId: randomUUID(), body: 'lọc' });
    await pool.query('update content.comments set platform_held=true where id=$1', [held.id]);
    expect((await cases.controls.queue(postId, AUTHOR, 0, 20)).items[0]).toMatchObject({
      platformBlocked: true,
      canApprove: true,
      willPublish: false,
    });
    await pool.query("update content.posts set status='held' where id=$1", [postId]);
    expect((await cases.controls.queue(postId, AUTHOR, 0, 20)).items[0]).toMatchObject({
      canApprove: false,
      approvalBlockReason: 'post_unavailable',
    });
    await expect(cases.controls.decide(held.id, AUTHOR, 'approve')).rejects.toThrow('Bài viết chưa hiển thị');
    expect((await cases.comments.findById(held.id))?.creatorReview).toBe('pending');
  });

  it('AI gắn cờ khi creator đang giữ phải thêm platform hold trước khi chủ bài duyệt', async () => {
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    const held = await cases.add.execute({ postId, authorId: randomUUID(), body: 'Cần lọc tiếp' });
    const target = (await cases.repository.loadTarget('comment', held.id))!;
    await cases.screen.execute(randomUUID(), target, {
      id: `comment:${held.id}`,
      flagged: false,
      scores: {},
      categories: {},
      model: 'clean',
    });
    expect((await cases.repository.queue({ view: 'pending', limit: 20, offset: 0 })).total).toBe(0);
    await cases.screen.execute(randomUUID(), target, {
      id: `comment:${held.id}`,
      flagged: true,
      scores: { harassment: 0.99 },
      categories: { harassment: true },
      model: 'test',
    });
    expect((await cases.comments.findById(held.id))?.platformHeld).toBe(true);
    await cases.controls.decide(held.id, AUTHOR, 'approve');
    expect((await cases.comments.findById(held.id))?.status).toBe('held');
  });

  it('sửa gốc bị keyword giữ phải giữ reply; staff restore không nhả reply khi chủ bài chưa duyệt', async () => {
    const member = randomUUID();
    const root = await cases.add.execute({ postId, authorId: member, body: 'Bình thường' });
    const child = await cases.add.execute({
      postId,
      authorId: randomUUID(),
      parentCommentId: root.id,
      body: 'Phản hồi sạch',
    });
    await cases.controls.updateSettings(postId, AUTHOR, { enabled: true, keywords: ['lọc'] });
    await cases.edit.execute({ commentId: root.id, userId: member, body: 'Cần lọc' });
    expect((await cases.comments.findById(child.id))?.status).toBe('held');
    await hide(root.id, 'restore');
    expect((await cases.comments.findById(child.id))?.status).toBe('held');
    await cases.controls.decide(root.id, AUTHOR, 'approve');
    expect((await cases.comments.findById(root.id))?.status).toBe('visible');
    expect((await cases.comments.findById(child.id))?.status).toBe('visible');
    expect(
      (await pool.query('select comment_count from content.posts where id=$1', [postId])).rows[0]
        .comment_count,
    ).toBe(2);
  });

  it('scan ghi tín hiệu staff trong transaction và rollback khi outbox lỗi', async () => {
    const eventId = randomUUID();
    const target = (await cases.repository.loadTarget('post', postId))!;
    failOutbox = true;
    await expect(cases.screen.execute(eventId, target, null)).rejects.toThrow('outbox unavailable');
    expect(await cases.repository.scan(eventId)).toBeUndefined();
    failOutbox = false;
    await cases.screen.execute(eventId, target, null);
    const signals = await pool.query(
      "select payload from content.outbox_events where type='content.moderation.changed'",
    );
    expect(signals.rows.map((row) => row.payload)).toContainEqual({ scope: 'scan', id: eventId });
  });

  it('khiếu nại mới có tín hiệu staff và không lưu nếu outbox lỗi', async () => {
    const root = await add();
    const decision = await hide(root.id);
    failOutbox = true;
    await expect(cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại')).rejects.toThrow(
      'outbox unavailable',
    );
    expect(await cases.repository.appealsByUser(AUTHOR, 20, 0)).toHaveLength(0);
    failOutbox = false;
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại');
    const signals = await pool.query(
      "select payload from content.outbox_events where type='content.moderation.changed'",
    );
    expect(signals.rows.map((row) => row.payload)).toContainEqual({ scope: 'appeal', id: appeal.id });
  });

  it('recovery có lease, giới hạn retry và staff có thể lên lịch lại', async () => {
    const eventId = randomUUID();
    const target = (await cases.repository.loadTarget('post', postId))!;
    for (let i = 0; i < 8; i++) await cases.screen.execute(eventId, target, null);
    expect((await cases.repository.scan(eventId))?.status).toBe('failed');
    expect(await cases.recovery.execute()).toHaveLength(0);
    await cases.recovery.retry(eventId, AUTHOR);
    const batches = await Promise.all([cases.recovery.execute(), cases.recovery.execute()]);
    expect(batches.flat().filter((row) => row.eventId === eventId)).toHaveLength(1);
    await cases.screen.execute(eventId, target, {
      id: eventId,
      flagged: false,
      model: 'test',
      categories: {},
      scores: {},
    });
    expect((await cases.repository.scan(eventId))?.status).toBe('passed');
    await cases.screen.execute(eventId, target, null);
    expect((await cases.repository.scan(eventId))?.status).toBe('passed');
  });
  it('worker phục hồi scan deferred từ database dù không còn lượt giao của stream', async () => {
    const eventId = randomUUID();
    const target = (await cases.repository.loadTarget('post', postId))!;
    await cases.screen.execute(eventId, target, null);
    await pool.query('update content.moderation_scans set next_attempt_at=now() where event_id=$1', [
      eventId,
    ]);
    const screen = new ScreenContentUseCase(
      cases.repository,
      {
        moderate: async () => [
          { id: eventId, flagged: false, model: 'recovered-provider', categories: {}, scores: {} },
        ],
      },
      cases.screen,
      { getPlayback: async () => ({}) } as never,
    );
    const worker = new ScreeningConsumer({ APP_ROLE: 'api' } as never, {} as never, screen, cases.recovery);
    await worker.recover();
    expect((await cases.repository.scan(eventId))?.status).toBe('passed');
    expect((await cases.repository.scan(eventId))?.model).toBe('recovered-provider');
  });
  it('hết hạn appeal và evidence cũ được dọn mà không xóa audit quyết định', async () => {
    const root = await add();
    const decision = await hide(root.id);
    await pool.query(
      "update content.moderation_actions set created_at=now()-interval '91 days' where id=$1",
      [decision.actionId],
    );
    await expect(cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại')).rejects.toThrow(/hết thời hạn/);
    await cases.recovery.execute();
    const row = (
      await pool.query('select evidence_snapshot, action from content.moderation_actions where id=$1', [
        decision.actionId,
      ])
    ).rows[0];
    expect(row.evidence_snapshot).toBeNull();
    expect(row.action).toBe('hide');
  });
  it('thay đổi counter không đổi phiên bản và snapshot quyết định vẫn giữ nội dung gốc', async () => {
    const target = (await cases.repository.loadTarget('post', postId))!;
    const decision = await cases.moderate.execute({
      postId,
      moderatorId: randomUUID(),
      action: 'hide',
      reasonCode: 'OTHER',
    });
    await pool.query('update content.posts set share_count=share_count+1, updated_at=now() where id=$1', [
      postId,
    ]);
    expect((await cases.repository.loadTarget('post', postId))?.version).toBe(target.version);
    expect(
      (await cases.repository.decisionsByUser(AUTHOR, 20, 0)).find((row) => row.id === decision.actionId)
        ?.canAppeal,
    ).toBe(true);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại');
    expect((await cases.repository.pendingAppeals(20, 0))[0]?.decision.evidenceSnapshot?.text).toBe(
      target.text,
    );
    await cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned');
  });
  it('report dedupe theo phiên bản và giới hạn 20 báo cáo mỗi giờ', async () => {
    const command = {
      targetType: 'post' as const,
      targetId: postId,
      reporterId: AUTHOR,
      reasonCode: 'OTHER',
    };
    const first = await cases.report.execute(command);
    expect((await cases.report.execute(command)).id).toBe(first.id);
    for (let i = 1; i < 20; i++) {
      await pool.query('update content.posts set body=$2 where id=$1', [postId, `Bản sửa ${i}`]);
      expect((await cases.report.execute(command)).id).not.toBe(first.id);
    }
    await pool.query("update content.posts set body='Bản sửa tiếp theo' where id=$1", [postId]);
    await expect(cases.report.execute(command)).rejects.toMatchObject({ status: 429 });
  });

  it('ẩn gốc cascade, hidden riêng không được restore theo gốc; outbox mỗi dòng đổi', async () => {
    const root = await add();
    const child = await cases.add.execute({
      postId,
      authorId: randomUUID(),
      body: 'Phản hồi được khôi phục cùng bình luận gốc',
      parentCommentId: root.id,
    });
    const separatelyHidden = await add(root.id);
    await hide(separatelyHidden.id);
    expect(await count()).toBe(2);
    await hide(root.id);
    expect(await count()).toBe(0);
    expect(await cases.comments.findByPostId({ postId, flat: true, limit: 200 })).toEqual([]);
    await hide(root.id, 'restore');
    const restoreDecision = await pool.query(
      `select payload from content.outbox_events
       where type='content.comment.moderation_action' and payload->>'action'='restore'`,
    );
    expect(restoreDecision.rows).toHaveLength(1);
    expect(restoreDecision.rows[0].payload).not.toHaveProperty('previouslyAutoHidden');
    expect(await count()).toBe(2);
    expect(
      (await cases.comments.findByPostId({ postId, flat: true, limit: 200 })).map((c) => c.id).sort(),
    ).toEqual([root.id, child.id].sort());
    const events = await pool.query(
      "select payload from content.outbox_events where type='content.comment.hidden'",
    );
    expect(events.rowCount).toBe(3);
    const restored = await pool.query(
      "select payload from content.outbox_events where type='content.comment.restored' order by payload->>'commentId'",
    );
    expect(restored.rows.map(({ payload }) => payload)).toEqual(
      [root, child]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((comment) => ({
          postId,
          postAuthorId: AUTHOR,
          postVisibility: 'public',
          commentId: comment.id,
          authorId: comment.authorId,
          parentCommentId: comment.parentCommentId,
          body: comment.body,
        })),
    );
  });
  it('đánh dấu restore nếu quyết định ẩn gần nhất của bình luận là tự động', async () => {
    const comment = await add();
    await cases.visibility.execute({
      targetType: 'comment',
      targetId: comment.id,
      action: 'hide',
      actorId: AUTHOR,
      actorType: 'system',
      reasonCode: 'HARASSMENT',
    });
    await hide(comment.id, 'restore');

    const restored = await pool.query(
      `select payload from content.outbox_events
       where type='content.comment.moderation_action' and payload->>'action'='restore'`,
    );
    expect(restored.rows).toHaveLength(1);
    expect(restored.rows[0].payload).toMatchObject({
      commentId: comment.id,
      action: 'restore',
      previouslyAutoHidden: true,
    });
  });
  it('đánh dấu restore tự ẩn trong event của moderation case', async () => {
    const comment = await add();
    const caseId = randomUUID();
    await cases.visibility.execute({
      targetType: 'comment',
      targetId: comment.id,
      action: 'hide',
      actorId: AUTHOR,
      actorType: 'system',
      reasonCode: 'HARASSMENT',
    });
    await cases.visibility.execute({
      targetType: 'comment',
      targetId: comment.id,
      action: 'restore',
      actorId: AUTHOR,
      actorType: 'staff',
      reasonCode: 'HARASSMENT',
      caseId,
    });

    const restored = await pool.query(
      `select payload from content.outbox_events
       where type='content.moderation.decided' and payload->>'action'='restore'`,
    );
    expect(restored.rows).toHaveLength(1);
    expect(restored.rows[0].payload).toMatchObject({
      caseId,
      targetId: comment.id,
      action: 'restore',
      previouslyAutoHidden: true,
    });
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
  it('khôi phục bình luận bị nền tảng gỡ nhưng không khôi phục nội dung tác giả đã xóa', async () => {
    const root = await add();
    const child = await add(root.id);
    await hide(root.id, 'remove');
    expect(await count()).toBe(0);
    await hide(root.id, 'restore');
    expect(await count()).toBe(2);
    expect((await cases.comments.findById(child.id))?.status).toBe('visible');
    await cases.delete.execute({ commentId: root.id, userId: AUTHOR });
    await expect(hide(root.id, 'restore')).rejects.toThrow();
  });
  it('chỉ tác giả có thể khiếu nại và mỗi quyết định chỉ có một khiếu nại', async () => {
    const root = await add();
    const decision = await hide(root.id);
    await expect(cases.appeal.execute(decision.actionId, randomUUID(), 'Kiểm tra lại')).rejects.toThrow();
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Kiểm tra lại');
    expect(appeal.status).toBe('pending');
    await expect(cases.appeal.execute(decision.actionId, AUTHOR, 'Lần hai')).rejects.toThrow(
      /đã được khiếu nại/,
    );
    await expect(cases.decideAppeal.execute(appeal.id, AUTHOR, 'overturned')).rejects.toThrow(/tự duyệt/);
    const outcome = await cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned');
    expect(outcome.status).toBe('overturned');
    expect((await cases.comments.findById(root.id))?.status).toBe('visible');
    await expect(cases.decideAppeal.execute(appeal.id, randomUUID(), 'upheld')).rejects.toThrow(
      /đã được xử lý/,
    );
  });
  it('không khôi phục khi nội dung đã thay đổi sau quyết định', async () => {
    const root = await add();
    const decision = await hide(root.id);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Kiểm tra lại');
    await pool.query(
      "update content.comments set body='đã sửa', updated_at=updated_at + interval '1 second' where id=$1",
      [root.id],
    );
    await expect(cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned')).rejects.toThrow(
      /đã thay đổi/,
    );
    expect((await cases.comments.findById(root.id))?.status).toBe('hidden');
  });
  it('không nhận khiếu nại cho quyết định đã được khôi phục', async () => {
    const root = await add();
    const decision = await hide(root.id);
    await hide(root.id, 'restore');
    await expect(cases.appeal.execute(decision.actionId, AUTHOR, 'Kiểm tra lại')).rejects.toThrow(
      /không còn hiệu lực/,
    );
  });
  it('không nhận appeal hoặc khôi phục bình luận trong bài tác giả đã xóa', async () => {
    const root = await add();
    const decision = await hide(root.id);
    await pool.query("update content.posts set status='deleted', deleted_at=now() where id=$1", [postId]);
    expect(
      (await cases.repository.decisionsByUser(AUTHOR, 20, 0)).find((row) => row.id === decision.actionId)
        ?.canAppeal,
    ).toBe(false);
    await expect(cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại')).rejects.toThrow();
    await expect(hide(root.id, 'restore')).rejects.toThrow();
  });
  it('đóng hồ sơ không làm mất quyền khiếu nại quyết định ẩn đang hiệu lực', async () => {
    const report = await cases.report.execute({
      targetType: 'post',
      targetId: postId,
      reporterId: AUTHOR,
      reasonCode: 'OTHER',
    });
    const decision = await cases.visibility.execute({
      targetType: 'post',
      targetId: postId,
      action: 'hide',
      actorId: randomUUID(),
      actorType: 'staff',
      reasonCode: 'OTHER',
      caseId: report.caseId!,
    });
    await cases.decide.execute(report.caseId!, {
      actorId: randomUUID(),
      action: 'dismiss',
      reasonCode: 'OTHER',
    });
    expect(
      (await cases.repository.decisionsByUser(AUTHOR, 20, 0)).find((row) => row.id === decision.actionId)
        ?.canAppeal,
    ).toBe(true);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại');
    await cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned');
    expect((await cases.repository.loadTarget('post', postId))?.status).toBe('published');
  });
  it('gỡ rồi khôi phục gốc không bỏ lệnh ẩn riêng của reply', async () => {
    const root = await add();
    const child = await add(root.id);
    await hide(child.id);
    await hide(root.id, 'remove');
    await hide(root.id, 'restore');
    expect((await cases.comments.findById(child.id))?.status).toBe('hidden');
    expect(await count()).toBe(1);
  });
  it('hai reviewer xử lý đồng thời chỉ có một kết quả và một event appeal', async () => {
    const root = await add();
    const decision = await hide(root.id);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại');
    const results = await Promise.allSettled([
      cases.decideAppeal.execute(appeal.id, randomUUID(), 'upheld'),
      cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await pool.query("select * from content.outbox_events where type='content.appeal.decided'")).rowCount,
    ).toBe(1);
  });
  it('lỗi outbox không đóng khiếu nại hoặc khôi phục nội dung', async () => {
    const root = await add();
    const decision = await hide(root.id);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Xem lại');
    failOutbox = true;
    await expect(cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned')).rejects.toThrow(
      'outbox unavailable',
    );
    expect((await cases.comments.findById(root.id))?.status).toBe('hidden');
    expect((await cases.repository.appealsByUser(AUTHOR, 20, 0))[0]?.status).toBe('pending');
  });
  it('quyết định bài trực tiếp có phiên bản và chỉ tác giả xem được', async () => {
    const reviewer = randomUUID();
    const decision = await cases.moderate.execute({
      postId,
      moderatorId: reviewer,
      action: 'hide',
      reasonCode: 'OTHER',
    });
    const decisions = await cases.repository.decisionsByUser(AUTHOR, 20, 0);
    expect(decisions.map((row) => row.id)).toContain(decision.actionId);
    expect(decisions.find((row) => row.id === decision.actionId)?.canAppeal).toBe(true);
    expect(await cases.repository.decisionsByUser(randomUUID(), 20, 0)).toHaveLength(0);
    const appeal = await cases.appeal.execute(decision.actionId, AUTHOR, 'Kiểm tra');
    expect(
      (await cases.repository.pendingAppeals(20, 0)).some(
        (row) => row.appeal.id === appeal.id && row.targetStatus === 'hidden',
      ),
    ).toBe(true);
    expect(await cases.repository.appealsByUser(randomUUID(), 20, 0)).toHaveLength(0);
    await cases.decideAppeal.execute(appeal.id, randomUUID(), 'overturned');
    expect((await cases.repository.loadTarget('post', postId))?.status).toBe('published');
    expect(
      (await cases.repository.decisionsByUser(AUTHOR, 20, 0)).find((row) => row.id === decision.actionId)
        ?.canAppeal,
    ).toBe(false);
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
  it('báo cáo trùng không tăng số; ba báo cáo không tự ẩn; case đã đóng trả conflict', async () => {
    const command = { targetType: 'post' as const, targetId: postId, reporterId: AUTHOR, reasonCode: 'SCAM' };
    const first = await cases.report.execute(command);
    expect((await cases.report.execute(command)).id).toBe(first.id);
    await cases.report.execute({ ...command, reporterId: randomUUID() });
    await cases.report.execute({ ...command, reporterId: randomUUID() });
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'published',
    );
    const item = await cases.repository.findCase(first.caseId!);
    expect(item?.reportCount).toBe(3);
    const ownReports = await cases.repository.reportsByUser(AUTHOR, 20, 0);
    expect(ownReports).toHaveLength(1);
    expect(ownReports[0]).toMatchObject({ id: first.id, caseStatus: 'pending' });
    expect(await cases.repository.reportsByUser(randomUUID(), 20, 0)).toHaveLength(0);
    await cases.decide.execute(item!.id, { actorId: AUTHOR, action: 'dismiss', reasonCode: 'OTHER' });
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
    const hiddenSnapshot = await cases.repository.loadTarget('post', postId);
    await cases.screen.execute(eventId, hiddenSnapshot!, {
      id: `post:${postId}`,
      model: 'test',
      flagged: true,
      categories: { 'self-harm/intent': true },
      scores: { 'self-harm/intent': 0.9 },
    });
    const item = await cases.repository.pending(hiddenSnapshot!);
    expect(item?.sources).toContain('ai');
    expect(
      (await pool.query("select * from content.moderation_actions where actor_type='system'")).rowCount,
    ).toBe(1);
    const scan = (
      await pool.query('select status, attempts, model from content.moderation_scans where event_id=$1', [
        eventId,
      ])
    ).rows[0];
    expect(scan).toMatchObject({ status: 'flagged', attempts: 3, model: 'test' });
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

  it('remove gốc giữ lệnh ẩn riêng của phản hồi, chỉ trừ visible; dismiss không đổi trạng thái', async () => {
    const root = await add();
    const child = await add(root.id);
    await hide(child.id);
    const result = await hide(root.id, 'remove');
    expect(result.changedCount).toBe(1);
    expect(await count()).toBe(0);
    expect(
      (await pool.query("select * from content.comments where status='removed' and deleted_at is null"))
        .rowCount,
    ).toBe(1);
    const report = await cases.report.execute({
      targetType: 'post',
      targetId: postId,
      reporterId: AUTHOR,
      reasonCode: 'OTHER',
    });
    await cases.decide.execute(report.caseId!, { actorId: AUTHOR, action: 'dismiss', reasonCode: 'OTHER' });
    expect((await cases.repository.findCase(report.caseId!))?.status).toBe('resolved');
    expect((await pool.query('select status from content.posts where id=$1', [postId])).rows[0].status).toBe(
      'published',
    );
  });

  it('đổi tab theo trạng thái hiện tại, vẫn đọc được bình luận đã ẩn và gỡ cùng nhật ký', async () => {
    const comment = await add();
    const report = await cases.report.execute({
      targetType: 'comment',
      targetId: comment.id,
      reporterId: AUTHOR,
      reasonCode: 'OTHER',
    });
    const actor = { actorId: AUTHOR, reasonCode: 'OTHER' };
    const queue = (view: 'pending' | 'reviewed' | 'hidden' | 'removed') =>
      cases.repository.queue({ view, targetType: 'comment', limit: 20, offset: 0 });

    expect((await queue('pending')).total).toBe(1);
    await cases.decide.execute(report.caseId!, { ...actor, action: 'hide' });
    expect(await count()).toBe(0);
    expect((await queue('pending')).total).toBe(0);
    const hidden = await queue('hidden');
    expect(hidden.total).toBe(1);
    expect(hidden.items[0]?.id).toBe(report.caseId);
    expect((await cases.repository.detail(hidden.items[0]!)).target?.text).toBeTruthy();

    await hide(comment.id, 'restore');
    expect(await count()).toBe(1);
    expect((await queue('hidden')).total).toBe(0);
    expect((await queue('reviewed')).total).toBe(1);

    await hide(comment.id, 'remove');
    expect(await count()).toBe(0);
    expect((await queue('reviewed')).total).toBe(0);
    const removed = await queue('removed');
    expect(removed.total).toBe(1);
    const detail = await cases.repository.detail(removed.items[0]!);
    expect(detail.target).toMatchObject({ status: 'removed', deleted: false });
    expect(detail.actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['hide', 'restore', 'remove']),
    );
  });

  it('bình luận tục tĩu, phản động tự ẩn dù AI lỗi, ghi đúng lý do; bình luận sạch giữ nguyên (TF88)', async () => {
    const write = (body: string) => cases.add.execute({ postId, authorId: AUTHOR, body });
    const profane = await write('đm thằng chủ homestay óc chó');
    const extremist = await write('đả đảo cộng sản, lật đổ chế độ');
    const clean = await write('mua hạt óc chó ở chợ đêm ngon lắm');
    for (const comment of [profane, extremist, clean]) {
      const snapshot = await cases.repository.loadTarget('comment', comment.id);
      await cases.screen.execute(randomUUID(), snapshot!, null);
    }
    const statusOf = async (id: string) =>
      (await pool.query('select status from content.comments where id=$1', [id])).rows[0].status;
    const reasonOf = async (id: string) =>
      (
        await pool.query(
          "select reason_code from content.moderation_actions where comment_id=$1 and actor_type='system'",
          [id],
        )
      ).rows[0]?.reason_code;
    expect(await statusOf(profane.id)).toBe('hidden');
    expect(await reasonOf(profane.id)).toBe('HARASSMENT');
    expect(await statusOf(extremist.id)).toBe('hidden');
    expect(await reasonOf(extremist.id)).toBe('EXTREMISM');
    expect(await statusOf(clean.id)).toBe('visible');
    expect(await reasonOf(clean.id)).toBeUndefined();
    expect(await count()).toBe(1);
  });

  it('dụ chuyển khoản ngoài app không có STK: không tự ẩn, hồ sơ mức 65, lý do SCAM (TF100)', async () => {
    const comment = await cases.add.execute({
      postId,
      authorId: AUTHOR,
      body: 'ib zalo 0912 345 678 chuyển khoản cọc giữ phòng nha',
    });
    const snapshot = await cases.repository.loadTarget('comment', comment.id);
    await cases.screen.execute(randomUUID(), snapshot!, null);

    const status = (await pool.query('select status from content.comments where id=$1', [comment.id])).rows[0]
      .status;
    const item = (
      await pool.query(
        "select severity, flags->>'reasonCode' as reason from content.moderation_cases where target_id=$1",
        [comment.id],
      )
    ).rows[0];
    expect(status).toBe('visible');
    expect(item).toMatchObject({ severity: 65, reason: 'SCAM' });
  });

  it('mọi sự kiện bình luận mang postVisibility để realtime phát vào phòng của bài (TF101)', async () => {
    const comment = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Cảnh đẹp quá' });
    await cases.edit.execute({ commentId: comment.id, userId: AUTHOR, body: 'Cảnh đẹp quá trời' });
    await hide(comment.id);
    await hide(comment.id, 'restore');
    const profane = await cases.add.execute({ postId, authorId: AUTHOR, body: 'đm thằng chủ homestay' });
    const snapshot = await cases.repository.loadTarget('comment', profane.id);
    await cases.screen.execute(randomUUID(), snapshot!, null);
    await cases.delete.execute({ commentId: comment.id, userId: AUTHOR });

    const { rows } = await pool.query(
      `select type, payload->>'postVisibility' as visibility from content.outbox_events
       where type in ('content.comment.created', 'content.comment.updated', 'content.comment.hidden',
                      'content.comment.restored', 'content.comment.deleted')`,
    );
    const types = new Set(rows.map((row: { type: string }) => row.type));
    expect(types).toEqual(
      new Set([
        'content.comment.created',
        'content.comment.updated',
        'content.comment.hidden',
        'content.comment.restored',
        'content.comment.deleted',
      ]),
    );
    expect(rows.filter((row: { visibility: string | null }) => row.visibility !== 'public')).toEqual([]);

    await pool.query("update content.posts set visibility='private' where id=$1", [postId]);
    const privateComment = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Riêng tư' });
    const privateEvent = await pool.query(
      "select payload->>'postVisibility' as visibility from content.outbox_events where payload->>'commentId'=$1",
      [privateComment.id],
    );
    expect(privateEvent.rows[0].visibility).toBe('private');
  });

  it('AI nguy hiểm tự ẩn bình luận; queue/detail đọc được đúng nguồn và evidence', async () => {
    const root = await add();
    const snapshot = await cases.repository.loadTarget('comment', root.id);
    await cases.screen.execute(randomUUID(), snapshot!, {
      id: `comment:${root.id}`,
      flagged: true,
      categories: { 'self-harm/intent': true },
      scores: { 'self-harm/intent': 0.99 },
      model: 'omni-test',
    });
    expect(await count()).toBe(0);
    const queue = await cases.repository.queue({
      source: 'ai',
      targetType: 'comment',
      status: 'pending',
      limit: 20,
      offset: 0,
    });
    expect(queue.total).toBe(1);
    expect(queue.items[0]?.isAutoHidden).toBe(true);
    const detail = await cases.repository.detail(queue.items[0]!);
    expect(detail.target?.status).toBe('hidden');
    expect(detail.actions).toHaveLength(1);
    expect(detail.flags).toMatchObject({ ai: { model: 'omni-test' } });
  });
  it('thống kê đếm ở server đúng khi hàng chờ vượt 100 dòng, khớp total của queue (TF89)', async () => {
    // 120 bài có hồ sơ chờ duyệt, 30 hồ sơ khẩn cấp (severity 90); vượt giới hạn 100 dòng FE từng tải.
    await pool.query(
      `
      with created as (
        insert into content.posts (id, author_id, post_type, title, status, published_at)
        select gen_random_uuid(), $1, 'video', 'Bài ' || n, 'published', now() from generate_series(1, 120) n
        returning id
      ), numbered as (select id, row_number() over () as n from created)
      insert into content.moderation_cases (target_type, target_id, post_id, author_id, severity, created_at)
      select 'post', id, id, $1, case when n <= 30 then 90 else 40 end, now() - (n || ' minutes')::interval
      from numbered`,
      [AUTHOR],
    );
    // Không được tính: hồ sơ đã đóng và hồ sơ của bài đã bị gỡ.
    const removedPost = randomUUID();
    await pool.query(
      "insert into content.posts (id, author_id, post_type, title, status) values ($1,$2,'video','Đã gỡ','removed')",
      [removedPost, AUTHOR],
    );
    await pool.query(
      `insert into content.moderation_cases (target_type, target_id, post_id, author_id, severity)
       values ('post', $1, $1, $2, 95)`,
      [removedPost, AUTHOR],
    );
    await pool.query(
      `insert into content.moderation_cases (target_type, target_id, post_id, author_id, severity, status)
       values ('post', $1, $1, $2, 95, 'resolved')`,
      [postId, AUTHOR],
    );
    // Hai bình luận chờ duyệt.
    const commentIds = [(await add()).id, (await add()).id];
    for (const commentId of commentIds) {
      await pool.query(
        `insert into content.moderation_cases (target_type, target_id, post_id, author_id, severity)
         values ('comment', $1, $2, $3, 85)`,
        [commentId, postId, AUTHOR],
      );
    }
    // Tự ẩn và báo cáo: một bản ghi trong 24 giờ, một bản ghi cũ hơn.
    const actions = await pool.query(
      `insert into content.moderation_actions
         (post_id, moderator_id, actor_type, action, previous_status, post_status, reason_code, created_at)
       values ($1, $2, 'system', 'auto_hide', 'published', 'hidden', 'SCAM', now() - interval '1 hour'),
              ($1, $2, 'system', 'auto_hide', 'published', 'hidden', 'SCAM', now() - interval '30 hours'),
              ($1, $2, 'staff', 'hide', 'published', 'hidden', 'SPAM', now())
       returning id`,
      [postId, AUTHOR],
    );
    await pool.query(
      `insert into content.reports (target_type, target_id, reporter_id, reason_code, created_at)
       values ('post', $1, gen_random_uuid(), 'SPAM', now()),
              ('post', $1, gen_random_uuid(), 'SPAM', now() - interval '2 days')`,
      [postId],
    );
    await pool.query(
      `insert into content.moderation_appeals (decision_id, author_id, reason) values ($1, $2, 'Không vi phạm')`,
      [actions.rows[2].id, AUTHOR],
    );
    await pool.query(
      `insert into content.moderation_scans (event_id, target_type, target_id, content_version, status)
       values (gen_random_uuid(), 'post', $1, 'v1', 'failed'),
              (gen_random_uuid(), 'post', $1, 'v1', 'deferred'),
              (gen_random_uuid(), 'post', $1, 'v1', 'deferred')`,
      [postId],
    );

    const stats = await cases.repository.stats(80);
    expect(stats).toMatchObject({
      pendingTotal: 122,
      pendingUrgent: 32,
      pendingPosts: 120,
      pendingComments: 2,
      autoHidden24h: 1,
      reports24h: 1,
      pendingAppeals: 1,
      failedScans: 1,
      deferredScans: 2,
      urgentSeverity: 80,
    });
    const oldest = await pool.query(
      `select min(created_at) as at from content.moderation_cases where status = 'pending' and target_id <> $1`,
      [removedPost],
    );
    expect(stats.oldestPendingAt).toBe(new Date(oldest.rows[0].at).toISOString());
    const queue = await cases.repository.queue({ view: 'pending', limit: 20, offset: 0 });
    expect(queue.total).toBe(stats.pendingTotal);
  });
});
