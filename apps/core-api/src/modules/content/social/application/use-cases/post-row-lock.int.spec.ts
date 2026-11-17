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
import { contentOutboxEvents } from '../../../db/schema/index.js';
import { BookmarkRepository } from '../../infra/bookmark.repository.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostCounterDeltaRepository } from '../../infra/post-counter-delta.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import { ReactionRepository } from '../../infra/reaction.repository.js';
import { AddCommentUseCase } from './add-comment.use-case.js';
import { BookmarkPostUseCase } from './bookmark-post.use-case.js';
import { DeleteCommentUseCase } from './delete-comment.use-case.js';
import { FlushCommentCountsUseCase } from './flush-comment-counts.use-case.js';
import { SetReactionUseCase } from './set-reaction.use-case.js';

const AUTHOR = '11111111-1111-4111-8111-111111111111';

/** TF99: rút ngắn thời gian khoá dòng bài nhưng số đếm vẫn đúng và không chen trả lời vào luồng đang xoá. */
describe('Khoá dòng bài khi thêm bình luận, thả tim, lưu bài (Postgres thật, chạy song song)', () => {
  let postgres: PostgresFixture;
  let pool: pg.Pool;
  let moduleRef: TestingModule;
  let postId: string;

  function bundle(tx: ModuleTransactionHost) {
    const posts = new PostRepository(() => tx.tx);
    const comments = new CommentRepository(() => tx.tx);
    const outbox = new OutboxWriter(() => tx.tx, contentOutboxEvents, 'core-api/content');
    const counterDeltas = new PostCounterDeltaRepository(() => tx.tx);
    return {
      add: new AddCommentUseCase(posts, comments, outbox, {
        // Tra tên chạy trước khi khoá: giả lập chậm để các lượt chồng lên nhau nhiều hơn.
        getDisplayNames: async (ids: string[]) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return new Map(ids.map((id) => [id, 'Người dùng']));
        },
      }, undefined, counterDeltas),
      flush: new FlushCommentCountsUseCase(counterDeltas),
      delete: new DeleteCommentUseCase(comments, posts, outbox),
      react: new SetReactionUseCase(posts, new ReactionRepository(() => tx.tx), outbox),
      bookmark: new BookmarkPostUseCase(posts, new BookmarkRepository(() => tx.tx)),
    };
  }
  let cases: ReturnType<typeof bundle>;

  beforeAll(async () => {
    postgres = await startPostgres();
    const url = postgres.buildModuleUrl('content');
    await migrateModule({
      url,
      module: 'content',
      migrationsFolder: fileURLToPath(new URL('../../../db/migrations', import.meta.url)),
    });
    pool = createPool({ url, max: 10, applicationName: 'tf99-post-row-lock-test' });
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
    await pool.query('truncate content.posts, content.outbox_events, content.post_counter_deltas cascade');
    postId = randomUUID();
    await pool.query(
      "insert into content.posts (id, author_id, post_type, title, status, published_at) values ($1,$2,'video','Bài đông','published',now())",
      [postId, AUTHOR],
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    await postgres?.stop();
  });

  async function readPost() {
    const { rows } = await pool.query<{
      comment_count: number;
      reaction_total: number;
      reaction_counts: Record<string, number>;
      bookmark_count: number;
    }>('select comment_count, reaction_total, reaction_counts, bookmark_count from content.posts where id = $1', [
      postId,
    ]);
    return rows[0]!;
  }

  async function pendingDeltas(): Promise<number> {
    const { rows } = await pool.query('select count(*)::int as count from content.post_counter_deltas');
    return rows[0].count;
  }

  it('30 người cùng gửi bình luận (bài đông): đủ 30 dòng; số đếm = cộng ngay + bảng đệm, đủ 30 sau khi job cộng', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        cases.add.execute({ postId, authorId: randomUUID(), body: `Bình luận ${index}` }),
      ),
    );

    const { rows } = await pool.query('select count(*)::int as count from content.comments where post_id = $1', [
      postId,
    ]);
    expect(rows[0].count).toBe(30);
    // Trước khi job chạy: phần cộng ngay + phần đang đệm luôn bằng số bình luận thật.
    expect((await readPost()).comment_count + (await pendingDeltas())).toBe(30);

    await cases.flush.execute();
    expect((await readPost()).comment_count).toBe(30);
    expect(await pendingDeltas()).toBe(0);
  });

  it('dòng bài đang bị giữ: lượt gửi không chờ, xong ngay và ghi +1 vào bảng đệm', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from content.posts where id = $1 for no key update', [postId]);

      const startedAt = Date.now();
      await cases.add.execute({ postId, authorId: randomUUID(), body: 'Không xếp hàng' });
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(await pendingDeltas()).toBe(1);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    await cases.flush.execute();
    expect((await readPost()).comment_count).toBe(1);
  });

  it('xoá gốc khi các trả lời còn nằm trong bảng đệm: số đếm về đúng 0, cộng dồn sau đó không làm lệch', async () => {
    const root = await cases.add.execute({ postId, authorId: AUTHOR, body: 'Gốc' });
    const holder = await pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select id from content.posts where id = $1 for no key update', [postId]);
      for (let index = 0; index < 8; index += 1) {
        await cases.add.execute({ postId, authorId: randomUUID(), body: `Trả lời ${index}`, parentCommentId: root.id });
      }
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    expect((await readPost()).comment_count).toBe(1);
    expect(await pendingDeltas()).toBe(8);

    // Trước khi sửa: trừ 9 trên số 1 bị chặn về 0, job cộng thêm 8 phần đệm, số đếm thành 8.
    await cases.delete.execute({ commentId: root.id, userId: AUTHOR, isSuperAdmin: false });
    expect((await readPost()).comment_count).toBe(0);
    expect(await pendingDeltas()).toBe(0);

    await cases.flush.execute();
    expect((await readPost()).comment_count).toBe(0);
  });

  it('xoá bình luận cùng lúc với lượt cộng dồn: không khoá chết, số đếm khớp', async () => {
    const roots = [];
    for (let index = 0; index < 6; index += 1) {
      roots.push(await cases.add.execute({ postId, authorId: AUTHOR, body: `Gốc ${index}` }));
    }
    await pool.query(
      'insert into content.post_counter_deltas (post_id, comment_delta) select $1, 1 from generate_series(1, 40)',
      [postId],
    );
    await pool.query(
      `insert into content.comments (post_id, author_id, body) select $1, $2, 'đã đệm ' || n from generate_series(1, 40) as n`,
      [postId, AUTHOR],
    );

    const results = await Promise.allSettled([
      ...roots.map((root) => cases.delete.execute({ commentId: root.id, userId: AUTHOR, isSuperAdmin: false })),
      cases.flush.execute(),
      cases.flush.execute(),
    ]);
    await cases.flush.execute();

    expect(results.filter((result) => result.status === 'rejected')).toEqual([]);
    expect((await readPost()).comment_count).toBe(40);
    expect(await pendingDeltas()).toBe(0);
  });

  it('một người gửi một mình (bài vắng): cộng ngay, không ghi bảng đệm', async () => {
    await cases.add.execute({ postId, authorId: randomUUID(), body: 'Một mình' });

    expect((await readPost()).comment_count).toBe(1);
    expect(await pendingDeltas()).toBe(0);
  });

  it('hai lượt cộng dồn chạy cùng lúc (2 bản worker): không cộng trùng', async () => {
    await pool.query(
      'insert into content.post_counter_deltas (post_id, comment_delta) select $1, 1 from generate_series(1, 50)',
      [postId],
    );

    const results = await Promise.all([cases.flush.execute(), cases.flush.execute(), cases.flush.execute()]);

    expect((await readPost()).comment_count).toBe(50);
    expect(await pendingDeltas()).toBe(0);
    expect(results.reduce((sum, result) => sum + result.deltaRows, 0)).toBe(50);
  });

  it('gửi trả lời cùng lúc với xoá bình luận gốc: không còn trả lời nào hiện dưới gốc đã xoá, số đếm khớp', async () => {
    for (let round = 0; round < 5; round += 1) {
      const root = await cases.add.execute({ postId, authorId: AUTHOR, body: `Gốc ${round}` });
      const replies = Array.from({ length: 8 }, (_, index) =>
        cases.add.execute({ postId, authorId: randomUUID(), body: `Trả lời ${index}`, parentCommentId: root.id }),
      );
      const deletion = cases.delete.execute({ commentId: root.id, userId: AUTHOR, isSuperAdmin: false });
      // Trả lời đến sau lúc xoá thì bị từ chối (gốc không còn): chấp nhận, chỉ cần dữ liệu không lệch.
      await Promise.allSettled([...replies, deletion]);
    }

    const orphan = await pool.query(
      `select count(*)::int as count from content.comments reply
       join content.comments root on root.id = reply.parent_comment_id
       where reply.post_id = $1 and reply.deleted_at is null and root.deleted_at is not null`,
      [postId],
    );
    expect(orphan.rows[0].count).toBe(0);
    await cases.flush.execute();
    const visible = await pool.query(
      "select count(*)::int as count from content.comments where post_id = $1 and deleted_at is null and status = 'visible'",
      [postId],
    );
    expect((await readPost()).comment_count).toBe(visible.rows[0].count);
  });

  it('nhiều người cùng thả, đổi, bỏ tim: reaction_total và reaction_counts khớp bảng reactions', async () => {
    const users = Array.from({ length: 12 }, () => randomUUID());
    await Promise.all(users.map((userId) => cases.react.execute({ postId, userId, type: 'like' })));
    await Promise.all(
      users.map((userId, index) =>
        cases.react.execute({ postId, userId, type: index % 3 === 0 ? null : index % 3 === 1 ? 'love' : 'like' }),
      ),
    );

    const { rows } = await pool.query<{ type: string; count: number }>(
      'select type, count(*)::int as count from content.reactions where post_id = $1 group by type',
      [postId],
    );
    const expected = Object.fromEntries(rows.map((row) => [row.type, row.count]));
    const post = await readPost();
    expect(post.reaction_counts).toEqual(expected);
    expect(post.reaction_total).toBe(rows.reduce((sum, row) => sum + row.count, 0));
  });

  it('một người bấm lưu bài 5 lần cùng lúc: bookmark_count chỉ tăng 1; bỏ lưu về 0', async () => {
    const userId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => cases.bookmark.execute({ postId, userId, isBookmarked: true })),
    );

    expect((await readPost()).bookmark_count).toBe(1);
    expect(results.every((result) => result.bookmarkCount === 1)).toBe(true);
    await cases.bookmark.execute({ postId, userId, isBookmarked: false });
    expect((await readPost()).bookmark_count).toBe(0);
  });
});
