import { hotV0 } from './builders/hot.js';
import { noneV0 } from './builders/none.js';
import { tagAffinityV0 } from './builders/tag-affinity.js';
import type { PostBuilder, Ranker, UserBuilder } from './contracts.js';
import { popularRankerV0, tagAffinityRankerV0 } from './rankers/rankers.js';

/** 'tên@version' → builder. Thêm builder = viết hàm + thêm một dòng ở đây. */
export const BUILDERS = new Map<string, { kind: 'post'; builder: PostBuilder } | { kind: 'user'; builder: UserBuilder }>([
  [hotV0.key, { kind: 'post', builder: hotV0 }],
  [tagAffinityV0.key, { kind: 'user', builder: tagAffinityV0 }],
  [noneV0.key, { kind: 'user', builder: noneV0 }],
]);

/** tên → ranker, khớp recommend_algos.ranker. */
export const RANKERS = new Map<string, Ranker>([tagAffinityRankerV0, popularRankerV0].map((r) => [r.name, r]));

export interface AlgoRow {
  name: string;
  postBuilder: string;
  userBuilder: string;
  ranker: string;
}

export type ResolvedAlgo = { name: string; postBuilder: PostBuilder; userBuilder: UserBuilder; ranker: Ranker };

/** Kiểm bộ ba của một dòng recommend_algos: builder có thật, đúng loại, và ranker khai báo đọc được. */
export function resolveAlgo(row: AlgoRow): { ok: true; algo: ResolvedAlgo } | { ok: false; error: string } {
  const post = BUILDERS.get(row.postBuilder);
  const user = BUILDERS.get(row.userBuilder);
  const ranker = RANKERS.get(row.ranker);
  if (post?.kind !== 'post') return { ok: false, error: `post_builder không có: ${row.postBuilder}` };
  if (user?.kind !== 'user') return { ok: false, error: `user_builder không có: ${row.userBuilder}` };
  if (!ranker) return { ok: false, error: `ranker không có: ${row.ranker}` };
  if (!ranker.accepts.postBuilders.includes(row.postBuilder) || !ranker.accepts.userBuilders.includes(row.userBuilder)) {
    return { ok: false, error: `ranker ${row.ranker} không đọc được ${row.postBuilder} + ${row.userBuilder}` };
  }
  return { ok: true, algo: { name: row.name, postBuilder: post.builder, userBuilder: user.builder, ranker } };
}
