import { z } from 'zod';
import { InvalidCommentMentionsException } from './errors.js';

export const CommentMentionSchema = z.object({
  userId: z.uuid().transform((id) => id.toLowerCase()),
  offset: z.number().int().nonnegative(),
  length: z.number().int().min(2),
});
export type CommentMention = z.infer<typeof CommentMentionSchema>;

const CommentMentionsSchema = z.array(CommentMentionSchema).max(10);

function isUtf16Boundary(body: string, offset: number): boolean {
  const code = body.charCodeAt(offset);
  return !(code >= 0xdc00 && code <= 0xdfff);
}

/** Các khoảng dùng UTF-16 như selectionStart của input trên web, tính cả ký tự @. */
export function validateCommentMentions(body: string, input: unknown): CommentMention[] {
  const parsed = CommentMentionsSchema.safeParse(input);
  if (!parsed.success) throw new InvalidCommentMentionsException();
  const mentions = parsed.data.sort((left, right) => left.offset - right.offset);
  const userIds = new Set<string>();
  let previousEnd = 0;
  for (const mention of mentions) {
    const end = mention.offset + mention.length;
    if (
      end > body.length ||
      mention.offset < previousEnd ||
      body[mention.offset] !== '@' ||
      !body.slice(mention.offset + 1, end).trim() ||
      !isUtf16Boundary(body, mention.offset) ||
      !isUtf16Boundary(body, end) ||
      userIds.has(mention.userId)
    )
      throw new InvalidCommentMentionsException();
    previousEnd = end;
    userIds.add(mention.userId);
  }
  return mentions;
}
