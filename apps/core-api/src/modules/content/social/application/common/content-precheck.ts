import { ConflictException } from '@nestjs/common';
import type { PostRecord } from '../../../db/schema/index.js';

export function postGateText(post: Pick<PostRecord, 'title' | 'body' | 'hashtags'>): string {
  return [post.title, post.body, ...post.hashtags].join('\n');
}

/**
 * So bản đã kiểm luật với bản vừa khoá, chỉ theo các trường nội dung tác giả sửa được.
 * Không so updatedAt và bộ đếm: thả tim, bình luận, chia sẻ, lưu bài (incrementCounter,
 * updateReactionCounts) đều đổi updatedAt, nên so updatedAt thì tác giả sửa bài bị 409 oan.
 */
export function assertPrecheckedPost(current: PostRecord, checked: PostRecord): void {
  const sameJson = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  if (
    current.status !== checked.status ||
    current.title !== checked.title ||
    current.body !== checked.body ||
    !sameJson(current.hashtags, checked.hashtags) ||
    current.visibility !== checked.visibility ||
    !sameJson(current.mediaIds, checked.mediaIds) ||
    (current.coverMediaId ?? null) !== (checked.coverMediaId ?? null) ||
    !sameJson(current.tripAttachment, checked.tripAttachment) ||
    current.isVerified !== checked.isVerified ||
    current.deletedAt?.getTime() !== checked.deletedAt?.getTime()
  ) {
    throw new ConflictException('Bài viết vừa thay đổi, vui lòng thử lại');
  }
}
