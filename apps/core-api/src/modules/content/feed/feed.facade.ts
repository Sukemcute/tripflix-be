import { Inject, Injectable } from '@nestjs/common';
import { FeedUseCases, type FeedPage } from './application/feed.use-cases.js';

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
}
