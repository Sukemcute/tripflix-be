import { Inject, Injectable } from '@nestjs/common';
import { FeedUseCases, type FeedPage, type HotFeedIdPage } from './application/feed.use-cases.js';

/** Hàm cho module khác lấy thẻ Reels phát được (ví dụ discovery trả bảng xu hướng kèm thẻ trong một request, TF23). */
@Injectable()
export class FeedFacade {
  constructor(@Inject(FeedUseCases) private readonly feed: FeedUseCases) {}

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
}
