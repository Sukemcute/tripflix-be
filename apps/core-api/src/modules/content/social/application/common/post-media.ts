import { assertMediaKindsForPostType, type PostMediaInfo } from '../../domain/index.js';
import type { PostType } from '../../../db/schema/index.js';
import type { PostMediaPort } from '../ports/post-media.port.js';

/**
 * Hỏi module media loại của từng id rồi kiểm luật gắn media vào bài. Không có port (test cũ) thì coi như
 * không tìm thấy id nào: bài viết kèm id lạ vẫn bị chặn.
 */
export async function assertPostMediaAllowed(
  postMedia: PostMediaPort | undefined,
  options: { postType: PostType; authorId: string; mediaIds: readonly string[] },
): Promise<void> {
  if (options.mediaIds.length === 0) return;
  const mediaInfo = postMedia
    ? await postMedia.findMediaInfo([...options.mediaIds])
    : new Map<string, PostMediaInfo>();
  assertMediaKindsForPostType(options.postType, options.authorId, options.mediaIds, mediaInfo);
}
