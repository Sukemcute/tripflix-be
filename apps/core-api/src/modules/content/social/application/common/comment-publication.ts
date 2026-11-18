import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { comments, type CommentRecord, type PostRecord } from '../../../db/schema/index.js';

type PublicationComment = Pick<
  CommentRecord,
  'id' | 'authorId' | 'body' | 'parentCommentId' | 'replyToCommentId' | 'authorDisplayName'
>;
type PublicationContext = { parentCommentAuthorId: string | null; replyToAuthorId: string | null };

/** One payload for immediate publication, creator approval and platform release. */
export function commentPublicationPayload(
  comment: PublicationComment,
  post: Pick<PostRecord, 'id' | 'authorId' | 'visibility'>,
  context: PublicationContext,
  createdAt = new Date().toISOString(),
) {
  return {
    postId: post.id,
    postAuthorId: post.authorId,
    postVisibility: post.visibility,
    commentId: comment.id,
    authorId: comment.authorId,
    parentCommentId: comment.parentCommentId,
    parentCommentAuthorId: context.parentCommentAuthorId,
    ...(comment.replyToCommentId ? { replyToCommentId: comment.replyToCommentId } : {}),
    ...(context.replyToAuthorId ? { replyToAuthorId: context.replyToAuthorId } : {}),
    // Legacy replies have no durable target; never infer it from a display name or thread root.
    replyRecipientKnown: Boolean(comment.replyToCommentId && context.replyToAuthorId),
    ...(comment.authorDisplayName ? { authorDisplayName: comment.authorDisplayName } : {}),
    body: comment.body,
    createdAt,
  };
}

export async function loadCommentPublicationContext(
  db: Db,
  postId: string,
  comment: PublicationComment,
): Promise<PublicationContext> {
  const ids = [comment.parentCommentId, comment.replyToCommentId].filter((id): id is string => !!id);
  const rows = ids.length
    ? await db
        .select({ id: comments.id, authorId: comments.authorId })
        .from(comments)
        .where(and(eq(comments.postId, postId), inArray(comments.id, ids)))
    : [];
  const authors = new Map(rows.map((row) => [row.id, row.authorId]));
  return {
    parentCommentAuthorId: comment.parentCommentId ? (authors.get(comment.parentCommentId) ?? null) : null,
    replyToAuthorId: comment.replyToCommentId ? (authors.get(comment.replyToCommentId) ?? null) : null,
  };
}
