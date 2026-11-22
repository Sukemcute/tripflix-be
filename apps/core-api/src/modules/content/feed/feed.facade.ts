import { Inject, Injectable } from '@nestjs/common';
import { FeedUseCases, type FeedPage, type HotFeedIdPage } from './application/feed.use-cases.js';
import { TrendScoresUseCases, type HotScore } from './application/trend-scores.use-cases.js';

/** Loại bài có điểm Hot. Giai đoạn 1 của TF111 chỉ chấm Reels; vlog thêm ở giai đoạn 2. */
export const TOP_HOT_POST_TYPES = ['video'] as const;
export type TopHotPostType = (typeof TOP_HOT_POST_TYPES)[number];

/** Hàm cho module khác lấy thẻ Reels phát được (ví dụ discovery trả bảng xu hướng kèm thẻ trong một request, TF23). */
@Injectable()
export class FeedFacade {
  constructor(
    @Inject(FeedUseCases) private readonly feed: FeedUseCases,
    @Inject(TrendScoresUseCases) private readonly trendScores: TrendScoresUseCases,
  ) {}

  /**
   * Thẻ Reels đúng thứ tự `postIds`, kèm thích/lưu của người xem. Bài ẩn, riêng tư, đã xoá, không phải Reels
   * hoặc video chưa xử lý xong thì không có trong kết quả. Mỗi lần nên gọi không quá vài chục id.
   */
  getByIds(postIds: string[], viewerId: string | null = null): Promise<FeedPage> {
    return this.feed.getByIds(postIds, viewerId);
  }

  /**
   * Id bài của tab Đang hot theo đúng thứ tự tab đó, đã bỏ bài ẩn, riêng tư, video chưa xử lý xong (TF110).
   * `cursor` null là trang đầu; trang sau truyền `cursor` của bài cuối cùng đã dùng, hoặc `nextCursor`.
   * `limit` từ 1 đến HOT_IDS_MAX_LIMIT, sai thì ném RangeError; cursor sai hoặc của tab khác thì ném InvalidHotCursorError.
   */
  getHotIds(query: { limit: number; cursor: string | null }): Promise<HotFeedIdPage> {
    return this.feed.getHotIds(query);
  }

  /**
   * Danh sách Hot của feed theo điểm giảm dần (TF111), giống getHotIds nhưng chọn loại bài. Chỉ có `video`;
   * loại khác thì ném RangeError. Các lỗi khác như getHotIds.
   */
  listTopHot(query: { postType: TopHotPostType; limit: number; cursor: string | null }): Promise<HotFeedIdPage> {
    if (!TOP_HOT_POST_TYPES.includes(query.postType)) {
      return Promise.reject(new RangeError(`postType phải là một trong ${TOP_HOT_POST_TYPES.join(', ')}`));
    }
    return this.feed.getHotIds({ limit: query.limit, cursor: query.cursor });
  }

  /**
   * Điểm Hot trong [0, 1] của các bài, job chấm lại mỗi 5 phút (TF111). Bài không có trong Map là bài chưa được
   * chấm: đăng quá 30 ngày, không phải Reels, hoặc mới đăng sau lượt chấm gần nhất; bên gọi coi như 0.
   * Không lọc bài bị ẩn sau lượt chấm: bên gọi vẫn dựng thẻ qua getByIds, nơi bài ẩn bị bỏ.
   */
  getHotScores(postIds: string[]): Promise<Map<string, HotScore>> {
    return this.trendScores.getScores(postIds);
  }
}
