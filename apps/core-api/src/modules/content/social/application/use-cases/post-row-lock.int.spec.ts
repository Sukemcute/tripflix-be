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
import { PostRepository } from '../../infra/post.repository.js';
import { ReactionRepository } from '../../infra/reaction.repository.js';
import { AddCommentUseCase } from './add-comment.use-case.js';
import { BookmarkPostUseCase } from './bookmark-post.use-case.js';
import { DeleteCommentUseCase } from './delete-comment.use-case.js';
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
    return {
      add: new AddCommentUseCase(posts, comments, outbox, {
        // Tra tên chạy trước khi khoá: giả lập chậm để các lượt chồng lên nhau nhiều hơn.
        getDisplayNames: async (ids: string[]) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return new Map(ids.map((id) => [id, 'Người dùng']));
        },
      }),
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
    await pool.query('truncate content.posts, content.outbox_events cascade');
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

  it('30 người cùng gửi bình luận: đủ 30 dòng và comment_count = 30', async () => {
    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        cases.add.execute({ postId, authorId: randomUUID(), body: `Bình luận ${index}` }),
      ),
    );

    const { rows } = await pool.query('select count(*)::int as count from content.comments where post_id = $1', [
      postId,
    ]);
    expect(rows[0].count).toBe(30);
    expect((await readPost()).comment_count).toBe(30);
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
