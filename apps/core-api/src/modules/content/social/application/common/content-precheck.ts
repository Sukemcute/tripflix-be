import { ConflictException } from '@nestjs/common';
import type { PostRecord } from '../../../db/schema/index.js';

export function postGateText(post: Pick<PostRecord, 'title' | 'body' | 'hashtags'>): string {
  return [post.title, post.body, ...post.hashtags].join('\n');
}

/** Không ghi nội dung khác với bản đã kiểm ngoài transaction khi có chỉnh sửa đồng thời. */
export function assertPrecheckedPost(current: PostRecord, checked: PostRecord): void {
  if (JSON.stringify(current) !== JSON.stringify(checked)) {
    throw new ConflictException('Bài viết vừa thay đổi, vui lòng thử lại');
  }
}
