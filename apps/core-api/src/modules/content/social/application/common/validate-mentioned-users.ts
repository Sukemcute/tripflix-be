import { InvalidCommentMentionsException, type CommentMention } from '../../domain/index.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';

/** Tra người dùng trước transaction; lỗi directory phải thất bại thay vì lưu tag chưa xác minh. */
export async function validateMentionedUsers(
  mentions: CommentMention[],
  userDirectory?: UserDirectoryPort,
): Promise<void> {
  if (!mentions.length) return;
  if (!userDirectory) throw new Error('UserDirectoryPort is required to validate mentions');
  const users = await userDirectory.getDisplayNames(mentions.map((mention) => mention.userId));
  if (mentions.some((mention) => !users.has(mention.userId))) {
    throw new InvalidCommentMentionsException('Người dùng được tag không tồn tại');
  }
}
