import { sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { postCounterDeltas, posts } from '../../db/schema/index.js';

const FLUSH_LOCK = 'content.post_counter_deltas.flush';

export interface FlushedCounterDeltas {
  /** Số dòng đệm đã cộng và xoá. */
  deltaRows: number;
  /** Số bài được cập nhật comment_count. */
  postCount: number;
}

/** Bảng đệm số bình luận của bài đang đông (TF99), xem schema post-counter-deltas. */
export class PostCounterDeltaRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  async addCommentDelta(postId: string, commentDelta: number): Promise<void> {
    await this.db.insert(postCounterDeltas).values({ postId, commentDelta });
  }

  /**
   * Chỉ một lượt cộng dồn chạy cùng lúc (nhiều bản worker): hai lượt cùng cập nhật nhiều bài theo thứ tự khác nhau
   * có thể khoá chết lẫn nhau. Khoá tự nhả khi transaction kết thúc.
   */
  async tryAcquireFlushLock(): Promise<boolean> {
    const result = await this.db.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${FLUSH_LOCK}, 0)) as ok`,
    );
    return Boolean(result.rows[0]?.ok);
  }

  /**
   * Một câu: lấy và xoá tối đa `limit` dòng đệm cũ nhất, cộng tổng theo bài vào comment_count. Cộng và xoá cùng
   * commit hoặc cùng huỷ nên không cộng hai lần, không mất lượt.
   */
  async flushCommentDeltas(limit: number): Promise<FlushedCounterDeltas> {
    const result = await this.db.execute<{ delta_rows: number; post_count: number }>(sql`
      WITH taken AS (
        DELETE FROM ${postCounterDeltas}
        WHERE ${postCounterDeltas.id} IN (
          SELECT queued.id FROM ${postCounterDeltas} AS queued ORDER BY queued.id LIMIT ${limit}
        )
        RETURNING ${postCounterDeltas.postId} AS post_id, ${postCounterDeltas.commentDelta} AS comment_delta
      ),
      sums AS (
        SELECT post_id, sum(comment_delta)::int AS delta, count(*)::int AS delta_rows FROM taken GROUP BY post_id
      ),
      updated AS (
        UPDATE ${posts} SET comment_count = GREATEST(0, comment_count + sums.delta), updated_at = now()
        FROM sums WHERE ${posts.id} = sums.post_id
        RETURNING ${posts.id}
      )
      SELECT coalesce((SELECT sum(delta_rows) FROM sums), 0)::int AS delta_rows,
             (SELECT count(*) FROM updated)::int AS post_count
    `);
    const row = result.rows[0];
    return { deltaRows: row?.delta_rows ?? 0, postCount: row?.post_count ?? 0 };
  }
}
