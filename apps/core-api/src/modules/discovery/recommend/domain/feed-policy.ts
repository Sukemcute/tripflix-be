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
  /** Đa dạng trang (chỉ bài có RankedItem.diversity, tức ranker v1): xem diversify(). */
  diversity: {
    /** Trong mỗi `window` bài liền nhau: tối đa `maxSamePlace` bài cùng một nơi, `maxSameExp` bài cùng trải nghiệm chính. */
    window: number;
    maxSamePlace: number;
    maxSameExp: number;
    /**
     * Nơi đang nhắm / đã đặt: chia danh sách thành khối `focusWindow` bài. Khối đầu đưa `maxFocus` bài của nơi đó lên đầu
     * (dù điểm thấp hơn), mỗi khối sau bớt 1, không dưới `minFocus`; ngoài số đó thì không thêm. Không quá `maxFocusRun` bài liền nhau.
     */
    focusWindow: number;
    maxFocus: number;
    minFocus: number;
    maxFocusRun: number;
    /** Chỉ sắp lại chừng này vị trí đầu (người xem hiếm khi cuộn sâu hơn); phần sau giữ thứ tự điểm. */
    top: number;
  };
}

/** Giá trị giữ chỗ (đề xuất mục 6.3), chỉnh bằng bộ đánh giá offline. */
export const FEED_POLICY: FeedPolicyConfig = {
  seenFactor: 0.1,
  interactedFactor: 0.2,
  authorFactor: 0.5,
  freePostsPerAuthor: 2,
  ownBoost: 10,
  diversity: { window: 5, maxSamePlace: 2, maxSameExp: 2, focusWindow: 10, maxFocus: 4, minFocus: 1, maxFocusRun: 4, top: 100 },
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

  const sorted = personal.sort(byFinal).map(({ item, final, applied }) => ({
    ...item,
    score: round4(final),
    breakdown: { ...item.breakdown, ...applied, final: round4(final) },
    reason: applied.ownBoost ? OWN_POST_REASON : item.reason,
  }));
  return diversify(sorted, cfg.diversity);
}

/**
 * Đa dạng nơi / trải nghiệm trong trang (thiết kế v1 mục 3.6): chỉ đổi vị trí, không bỏ bài, không đổi điểm.
 * Tham lam: mỗi vị trí lấy bài điểm cao nhất không phạm luật với các bài vừa xếp; nới luật trải nghiệm trước, rồi mới bỏ luật.
 * Bài không có `diversity` (ranker v0, bài tự đăng) không bao giờ phạm luật nên giữ chỗ như cũ.
 */
export function diversify(items: RankedItem[], cfg: FeedPolicyConfig['diversity'] = FEED_POLICY.diversity): RankedItem[] {
  if (!items.some((i) => i.diversity)) return items;
  const pool = [...items];
  const out: RankedItem[] = [];
  // Khối đầu nhiều bài nơi vừa được chú ý, các khối sau giảm dần: cuộn sâu vẫn thấy nơi khác.
  const focusQuota = () => Math.max(cfg.minFocus, cfg.maxFocus - Math.floor(out.length / cfg.focusWindow));
  const focusInBlock = () => out.slice(out.length - (out.length % cfg.focusWindow)).filter((i) => i.diversity?.isFocus).length;
  const violates = (c: RankedItem, checkExp: boolean): boolean => {
    const d = c.diversity;
    if (!d) return false;
    const recent = out.slice(-(cfg.window - 1)).map((i) => i.diversity);
    if (d.isFocus) {
      let run = 0;
      for (let k = out.length - 1; k >= 0 && out[k]!.diversity?.isFocus; k--) run++;
      if (focusInBlock() >= focusQuota() || run >= cfg.maxFocusRun) return true;
    } else if (d.place && recent.filter((r) => r && !r.isFocus && r.place === d.place).length >= cfg.maxSamePlace) {
      return true;
    }
    return checkExp && d.exp !== null && recent.filter((r) => r?.exp === d.exp).length >= cfg.maxSameExp;
  };
  while (out.length < cfg.top && pool.length) {
    // Đầu mỗi khối: đẩy bài của nơi vừa được chú ý lên trước cho đủ số của khối.
    let at = focusInBlock() < focusQuota() ? pool.findIndex((c) => c.diversity?.isFocus && !violates(c, false)) : -1;
    if (at < 0) at = pool.findIndex((c) => !violates(c, true));
    if (at < 0) at = pool.findIndex((c) => !violates(c, false));
    if (at < 0) at = 0;
    const [picked] = pool.splice(at, 1);
    out.push(at > 0 ? { ...picked!, breakdown: { ...picked!.breakdown, diversityMoved: 1 } } : picked!);
  }
  return [...out, ...pool];
}
