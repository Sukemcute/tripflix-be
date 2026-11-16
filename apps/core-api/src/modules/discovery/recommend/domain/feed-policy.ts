import { round4, type RankedItem } from './contracts.js';

export interface FeedPolicyConfig {
  /** Bài đã gợi ý ở phiên trước. */
  seenFactor: number;
  /** Bài đã tương tác (không tính bài tự đăng). */
  interactedFactor: number;
  /** Bài thứ n > freePostsPerAuthor của cùng tác giả nhân authorFactor^(n − freePostsPerAuthor). */
  authorFactor: number;
  freePostsPerAuthor: number;
  /** Cộng cho bài tự đăng gần đây; điểm ranker nằm trong [0, 1] nên bài này lên đầu. */
  ownBoost: number;
}

/** Giá trị giữ chỗ (đề xuất mục 6.3), chỉnh bằng bộ đánh giá offline. */
export const FEED_POLICY: FeedPolicyConfig = {
  seenFactor: 0.1,
  interactedFactor: 0.2,
  authorFactor: 0.5,
  freePostsPerAuthor: 2,
  ownBoost: 10,
};

/** Tín hiệu của người xem, chốt theo mốc trang đầu để phân trang ổn định. */
export interface ViewerSignals {
  userId: string | null;
  seen: ReadonlySet<string>;
  interacted: ReadonlySet<string>;
  ownRecent: ReadonlySet<string>;
}

export const OWN_POST_REASON = { code: 'own_post', text: 'Bài bạn vừa đăng' };

type Adjusted = { item: RankedItem; final: number; applied: Record<string, number> };

const byFinal = (a: Adjusted, b: Adjusted) => b.final - a.final;

/**
 * Tầng chính sách theo người xem: không bỏ bài nào, chỉ nhân hệ số / cộng điểm rồi sắp lại.
 * Sắp ổn định nên hoà điểm giữ thứ tự của ranker. Hệ số đã áp ghi vào breakdown để đo từng luật.
 */
export function applyFeedPolicy(ranked: RankedItem[], viewer: ViewerSignals, cfg: FeedPolicyConfig = FEED_POLICY): RankedItem[] {
  const personal = ranked
    .map((item): Adjusted => {
      const isOwn = viewer.userId !== null && item.authorId === viewer.userId;
      const applied: Record<string, number> = {};
      if (viewer.seen.has(item.postId)) applied.seenFactor = cfg.seenFactor;
      if (!isOwn && viewer.interacted.has(item.postId)) applied.interactedFactor = cfg.interactedFactor;
      if (viewer.ownRecent.has(item.postId)) applied.ownBoost = cfg.ownBoost;
      const final = item.score * (applied.seenFactor ?? 1) * (applied.interactedFactor ?? 1) + (applied.ownBoost ?? 0);
      return { item, final, applied };
    })
    .sort(byFinal);

  // Đa dạng tác giả tính trên thứ tự sau các luật trên: bài bị phạt nặng không chiếm suất của tác giả.
  const perAuthor = new Map<string, number>();
  for (const a of personal) {
    const n = (perAuthor.get(a.item.authorId) ?? 0) + 1;
    perAuthor.set(a.item.authorId, n);
    if (n <= cfg.freePostsPerAuthor) continue;
    a.applied.authorFactor = cfg.authorFactor ** (n - cfg.freePostsPerAuthor);
    a.final *= a.applied.authorFactor;
  }

  return personal.sort(byFinal).map(({ item, final, applied }) => ({
    ...item,
    score: round4(final),
    breakdown: { ...item.breakdown, ...applied, final: round4(final) },
    reason: applied.ownBoost ? OWN_POST_REASON : item.reason,
  }));
}
