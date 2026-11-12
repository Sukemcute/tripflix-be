import { PLACES } from '../../../search/domain/places.js';
import { round4, type Candidate, type RankedItem, type Ranker } from '../contracts.js';

const MAX_PER_AUTHOR = 2;
const TRENDING = { code: 'trending', text: 'Bài viết thịnh hành trên TripFlix' };

type Scored = { candidate: Candidate; final: number; item: RankedItem };

/** Sắp giảm dần theo final, rồi hot, rồi postId (phá hoà cố định); tối đa 2 bài/tác giả, dư thì dồn cuối. */
function sortWithAuthorCap(scored: Scored[]): RankedItem[] {
  scored.sort(
    (a, b) => b.final - a.final || b.candidate.score - a.candidate.score || a.candidate.postId.localeCompare(b.candidate.postId),
  );
  const perAuthor = new Map<string, number>();
  const head: RankedItem[] = [];
  const overflow: RankedItem[] = [];
  for (const { candidate, item } of scored) {
    const n = perAuthor.get(candidate.authorId) ?? 0;
    perAuthor.set(candidate.authorId, n + 1);
    (n < MAX_PER_AUTHOR ? head : overflow).push(item);
  }
  return [...head, ...overflow];
}

const weightMap = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, w]) => typeof w === 'number')) : {};
const num = (v: unknown, fallback: number) => (typeof v === 'number' ? v : fallback);
const placeName = (id: string) => PLACES.find((p) => p.id === id)?.name ?? id;

/**
 * tag_affinity_v0: final = 0.5·tagMatch + 0.2·placeMatch + 0.3·hot; không có gu thì final = hot.
 * Đối chiếu experiments/recommend/rec/rankers/tag_affinity_v0.py.
 */
export const tagAffinityRankerV0: Ranker = {
  name: 'tag_affinity_v0',
  accepts: { postBuilders: ['hot@v0'], userBuilders: ['tag_affinity@v0'] },
  rank({ candidates, userFeatures }, params = {}) {
    const wTag = num(params.wTag, 0.5);
    const wPlace = num(params.wPlace, 0.2);
    const wHot = num(params.wHot, 0.3);
    const userTags = weightMap(userFeatures?.tags);
    const userPlaces = weightMap(userFeatures?.places);
    const isPersonalized = Object.keys(userTags).length > 0 || Object.keys(userPlaces).length > 0;

    return sortWithAuthorCap(
      candidates.map((c) => {
        const hot = c.score;
        if (!isPersonalized) {
          const item = { postId: c.postId, score: round4(hot), source: c.source, breakdown: { tagMatch: 0, placeMatch: 0, hot: round4(hot), final: round4(hot) }, reason: TRENDING };
          return { candidate: c, final: hot, item };
        }
        const tagWeights = c.tags.map((t) => userTags[t.trim().toLowerCase()] ?? 0).sort((a, b) => b - a);
        const tagMatch = ((tagWeights[0] ?? 0) + (tagWeights[1] ?? 0) + (tagWeights[2] ?? 0)) / 3;
        const placeMatch = c.placeId ? (userPlaces[c.placeId] ?? 0) : 0;
        const final = wTag * tagMatch + wPlace * placeMatch + wHot * hot;

        let reason = TRENDING;
        if (placeMatch > 0 && placeMatch >= tagMatch && c.placeId) {
          reason = { code: 'matches_place', text: `Vì bạn quan tâm ${placeName(c.placeId)}` };
        } else if (tagMatch > 0) {
          const best = [...c.tags].sort((a, b) => (userTags[b.trim().toLowerCase()] ?? 0) - (userTags[a.trim().toLowerCase()] ?? 0))[0];
          reason = { code: 'matches_interest', text: `Vì bạn thích chủ đề #${best}` };
        }
        const breakdown = { tagMatch: round4(tagMatch), placeMatch: round4(placeMatch), hot: round4(hot), final: round4(final) };
        return { candidate: c, final, item: { postId: c.postId, score: round4(final), source: c.source, breakdown, reason } };
      }),
    );
  },
};

/** popular_v0: sắp theo hot, bỏ qua gu người dùng. */
export const popularRankerV0: Ranker = {
  name: 'popular_v0',
  accepts: { postBuilders: ['hot@v0'], userBuilders: ['none@v0', 'tag_affinity@v0'] },
  rank({ candidates }) {
    return sortWithAuthorCap(
      candidates.map((c) => ({
        candidate: c,
        final: c.score,
        item: { postId: c.postId, score: round4(c.score), source: c.source, breakdown: { hot: round4(c.score), final: round4(c.score) }, reason: TRENDING },
      })),
    );
  },
};
