import { DEFAULT_WEB_APP_URL } from '../../../../platform/env.js';
import type { PostType } from '../../db/schema/index.js';

/**
 * Link chia sẻ bài trên web: trang Cảm hứng mở sẵn bài (`?open=`), Reel thì thêm `kind=reel` để mở trong trình
 * xem Reels. Cùng dạng với link web tự tạo (tripflix-fe `post-share.ts`).
 */
export class PostShareLinks {
  private readonly webAppUrl: string;

  constructor(webAppUrl: string = DEFAULT_WEB_APP_URL) {
    this.webAppUrl = webAppUrl.replace(/\/+$/, '');
  }

  buildUrl(postId: string, postType: PostType): string {
    const params = new URLSearchParams({ open: postId });
    if (postType === 'video') params.set('kind', 'reel');
    return `${this.webAppUrl}/inspiration?${params.toString()}`;
  }
}
