import { ConflictException } from '@nestjs/common';
import type { PostRecord } from '../../../db/schema/index.js';

export function postGateText(post: Pick<PostRecord, 'title' | 'body' | 'hashtags'>): string {
  return [post.title, post.body, ...post.hashtags].join('\n');
}

/** So phiên bản nội dung, bỏ qua bộ đếm tương tác vì chúng không đổi updatedAt. */
export function assertPrecheckedPost(current: PostRecord, checked: PostRecord): void {
  if (
    current.status !== checked.status ||
    current.title !== checked.title ||
    current.body !== checked.body ||
    JSON.stringify(current.hashtags) !== JSON.stringify(checked.hashtags) ||
    current.updatedAt.getTime() !== checked.updatedAt.getTime() ||
    current.deletedAt?.getTime() !== checked.deletedAt?.getTime()
  ) {
    throw new ConflictException('Bài viết vừa thay đổi, vui lòng thử lại');
  }
}
