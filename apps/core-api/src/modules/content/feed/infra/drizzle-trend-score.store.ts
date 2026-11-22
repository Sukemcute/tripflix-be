import type { Db } from '@tripflix/db';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { bookmarks, comments, posts, reactions, trendScores, trendSignals } from '../../db/schema/index.js';
import { HOT_GUEST_VIEW_FACTOR, HOT_HALF_LIFE_HOURS, HOT_TREND_WEIGHTS } from '../domain/hot-trend.js';
import type { HotCandidateRow, TrendScoreRow, TrendScoreStore } from '../application/ports.js';

/** 0,5^(tuổi / 48h); thời điểm ở tương lai (lệch đồng hồ) tính như vừa xong. Cùng công thức với decayFactor. */
function decayed(now: string, at: SQL): SQL {
  return sql`power(0.5::float8, greatest(0, extract(epoch from (${now}::timestamptz - ${at}))) / ${HOT_HALF_LIFE_HOURS * 3600}::float8)`;
}

export class DrizzleTrendScoreStore implements TrendScoreStore {
  constructor(private readonly getDb: () => Db) {}

  async listHotCandidates({ now, since }: { now: Date; since: Date }): Promise<HotCandidateRow[]> {
    const at = now.toISOString();
    const w = HOT_TREND_WEIGHTS;
    // Mỗi nguồn tín hiệu là một dòng mỗi người mỗi bài (docs/10, chống đẩy ảo); tương tác của tác giả với bài mình không tính.
    const result = await this.getDb().execute<{
      post_id: string;
      media_ids: unknown;
      cover_media_id: string | null;
      body: string;
      hashtags: unknown;
      trip_attachment: HotCandidateRow['tripAttachment'];
      decayed_signal: number | string;
    }>(sql`
      with candidates as (
        select ${posts.id} as id, ${posts.authorId} as author_id
        from ${posts}
        where ${posts.status} = 'published' and ${posts.visibility} = 'public' and ${posts.deletedAt} is null
          and ${posts.postType} = 'video' and ${posts.createdAt} > ${since.toISOString()}::timestamptz
      ),
      signals as (
        select r.post_id, ${w.like}::float8 * ${decayed(at, sql`r.created_at`)} as weight
        from ${reactions} r join candidates c on c.id = r.post_id
        where r.user_id <> c.author_id
        union all
        select cm.post_id, ${w.comment}::float8 * ${decayed(at, sql`cm.first_at`)}
        from (
          select ${comments.postId} as post_id, ${comments.authorId} as author_id, min(${comments.createdAt}) as first_at
          from ${comments}
          where ${comments.status} = 'visible' and ${comments.deletedAt} is null
            and ${comments.creatorReview} = 'approved' and not ${comments.platformHeld}
          group by ${comments.postId}, ${comments.authorId}
        ) cm join candidates c on c.id = cm.post_id
        where cm.author_id <> c.author_id
        union all
        select b.post_id, ${w.save}::float8 * ${decayed(at, sql`b.created_at`)}
        from ${bookmarks} b join candidates c on c.id = b.post_id
        where b.user_id <> c.author_id
        union all
        select s.post_id,
          (case when s.kind = 'view'
            then ${w.view}::float8 * (case when s.is_guest then ${HOT_GUEST_VIEW_FACTOR}::float8 else 1 end)
            else ${w.bookingClick}::float8 end) * ${decayed(at, sql`s.occurred_at`)}
        from ${trendSignals} s join candidates c on c.id = s.post_id
        where s.actor_key <> 'u:' || c.author_id::text
      ),
      totals as (select post_id, sum(weight) as decayed_signal from signals group by post_id)
      select p.id as post_id, p.media_ids, p.cover_media_id, p.body, p.hashtags, p.trip_attachment,
        coalesce(t.decayed_signal, 0) as decayed_signal
      from candidates c
      join ${posts} p on p.id = c.id
      left join totals t on t.post_id = c.id
    `);
    return result.rows.map((row) => ({
      postId: row.post_id,
      // jsonb có thể sai dạng (sự cố 13/11): không phải mảng thì coi như rỗng thay vì làm hỏng cả lượt chấm.
      mediaIds: Array.isArray(row.media_ids) ? row.media_ids.filter((id): id is string => typeof id === 'string') : [],
      coverMediaId: row.cover_media_id,
      body: row.body,
      hashtags: Array.isArray(row.hashtags) ? row.hashtags.filter((tag): tag is string => typeof tag === 'string') : [],
      tripAttachment: row.trip_attachment,
      decayedSignal: Number(row.decayed_signal),
    }));
  }

  async replaceScores(rows: TrendScoreRow[], computedAt: Date): Promise<void> {
    const ids = rows.map((row) => row.postId);
    await this.getDb().execute(sql`delete from ${trendScores} where not (${trendScores.postId} = any(${sql.param(ids)}::uuid[]))`);
    if (rows.length === 0) return;
    // Nối với posts: bài bị xoá cứng giữa lúc đọc và lúc ghi thì bỏ qua, thay vì lỗi khoá ngoại làm hỏng cả lượt.
    await this.getDb().execute(sql`
      insert into ${trendScores} (post_id, score, raw, decayed_signal, completeness, computed_at)
      select u.post_id, u.score, u.raw, u.decayed_signal, u.completeness, ${computedAt.toISOString()}::timestamptz
      from unnest(
        ${sql.param(ids)}::uuid[],
        ${sql.param(rows.map((row) => row.score))}::float8[],
        ${sql.param(rows.map((row) => row.raw))}::float8[],
        ${sql.param(rows.map((row) => row.decayedSignal))}::float8[],
        ${sql.param(rows.map((row) => row.completeness))}::float8[]
      ) as u(post_id, score, raw, decayed_signal, completeness)
      join ${posts} on ${posts.id} = u.post_id
      on conflict (post_id) do update set
        score = excluded.score, raw = excluded.raw, decayed_signal = excluded.decayed_signal,
        completeness = excluded.completeness, computed_at = excluded.computed_at
    `);
  }

  async findScores(postIds: string[]): Promise<Array<{ postId: string; score: number; computedAt: string }>> {
    if (postIds.length === 0) return [];
    const rows = await this.getDb()
      .select({ postId: trendScores.postId, score: trendScores.score, computedAt: trendScores.computedAt })
      .from(trendScores)
      .where(inArray(trendScores.postId, postIds));
    return rows.map((row) => ({ postId: row.postId, score: row.score, computedAt: row.computedAt.toISOString() }));
  }
}
