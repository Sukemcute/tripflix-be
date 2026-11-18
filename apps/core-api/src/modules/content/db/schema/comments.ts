import { boolean, check, index, integer, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { contentSchema } from './content-schema.js';
import { posts } from './posts.js';
import { sql } from 'drizzle-orm';

/**
 * Bảng comments: Quản lý bình luận và phản hồi (1-level reply) trên bài đăng.
 * Schema: content
 */
export const comments = contentSchema.table(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull(),
    parentCommentId: uuid('parent_comment_id'),
    replyToCommentId: uuid('reply_to_comment_id'),
    authorDisplayName: text('author_display_name'),
    replyToName: text('reply_to_name'),
    body: text('body').notNull(),
    // held: luật nhanh giữ lại lúc đăng, chờ kiểm duyệt (TF90).
    status: varchar('status', { length: 20 })
      .$type<'visible' | 'held' | 'hidden' | 'removed'>()
      .notNull()
      .default('visible'),
    hiddenByActionId: uuid('hidden_by_action_id'),
    creatorReview: varchar('creator_review', { length: 12 })
      .$type<'approved' | 'pending' | 'rejected'>()
      .notNull()
      .default('approved'),
    platformHeld: boolean('platform_held').notNull().default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    cascadeRootCommentId: uuid('cascade_root_comment_id'),
    likeCount: integer('like_count').notNull().default(0),
    isEdited: boolean('is_edited').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_comments_creator_pending')
      .on(t.postId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.creatorReview} = 'pending' AND ${t.deletedAt} IS NULL`),
    check('ck_comments_status', sql`${t.status} IN ('visible', 'held', 'hidden', 'removed')`),
    check('ck_comments_creator_review', sql`${t.creatorReview} IN ('approved', 'pending', 'rejected')`),
    index('idx_comments_post_created').on(t.postId, t.createdAt),
    index('idx_comments_parent').on(t.parentCommentId),
    index('idx_comments_author').on(t.authorId),
    // Trang bình luận gốc, trang trả lời đọc đúng 21 dòng theo thứ tự trang thay vì lọc qua mọi trả lời, bình luận đã xoá.
    // status, author_id ở cuối: đếm tổng theo readableStatus chỉ đọc index, không đọc từng dòng (Drizzle chưa có INCLUDE).
    // NULLS FIRST cho khớp ORDER BY ... DESC của Postgres; drizzle-kit mặc định ghi NULLS LAST thì không dùng được thứ tự index (TF99).
    index('idx_comments_post_root_created')
      .on(t.postId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst(), t.status, t.authorId)
      .where(sql`${t.parentCommentId} IS NULL AND ${t.deletedAt} IS NULL`),
    index('idx_comments_parent_created')
      .on(t.parentCommentId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst(), t.status, t.authorId)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

type StoredComment = typeof comments.$inferSelect;
export type CommentRecord = Omit<
  StoredComment,
  'replyToName' | 'creatorReview' | 'platformHeld' | 'publishedAt' | 'replyToCommentId' | 'authorDisplayName'
> &
  Partial<
    Pick<
      StoredComment,
      | 'replyToName'
      | 'creatorReview'
      | 'platformHeld'
      | 'publishedAt'
      | 'replyToCommentId'
      | 'authorDisplayName'
    >
  >;
export type NewCommentRecord = typeof comments.$inferInsert;
