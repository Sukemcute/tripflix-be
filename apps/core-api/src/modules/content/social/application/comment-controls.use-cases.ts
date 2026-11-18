import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Transactional, type Db } from '@tripflix/db';
import { comments, posts, type PostRecord } from '../../db/schema/index.js';
import type { ContentOutbox } from './ports/content-outbox.port.js';
import { Post } from '../domain/post.entity.js';

export class CommentControlsUseCases {
  constructor(
    private readonly getDb: () => Db,
    private readonly outbox: ContentOutbox,
  ) {}
  private get db() {
    return this.getDb();
  }

  private async ownedPost(postId: string, userId: string) {
    const [post] = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), isNull(posts.deletedAt)))
      .for('update');
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');
    if (post.authorId !== userId) throw new ForbiddenException('Chỉ chủ bài được quản lý bình luận');
    return post;
  }

  async permissions(postId: string, viewerId?: string) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, postId));
    if (!post || !new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined }).canBeViewedBy(viewerId))
      throw new NotFoundException('Không tìm thấy bài viết');
    return {
      enabled: post.commentsEnabled && post.status === 'published',
      canManage: post.authorId === viewerId,
    };
  }

  @Transactional('content')
  async settings(postId: string, userId: string) {
    const post = await this.ownedPost(postId, userId);
    return { enabled: post.commentsEnabled, keywords: post.commentKeywords };
  }

  @Transactional('content')
  async updateSettings(postId: string, userId: string, input: { enabled: boolean; keywords: string[] }) {
    await this.ownedPost(postId, userId);
    await this.db
      .update(posts)
      .set({ commentsEnabled: input.enabled, commentKeywords: input.keywords })
      .where(eq(posts.id, postId));
    return input;
  }

  @Transactional('content')
  async queue(postId: string, userId: string, offset: number, limit: number) {
    await this.ownedPost(postId, userId);
    const rows = await this.db
      .select()
      .from(comments)
      .where(
        and(eq(comments.postId, postId), eq(comments.creatorReview, 'pending'), isNull(comments.deletedAt)),
      )
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit + 1)
      .offset(offset);
    return {
      items: rows
        .slice(0, limit)
        .map((row) => ({
          id: row.id,
          postId,
          authorId: row.authorId,
          parentCommentId: row.parentCommentId,
          body: ['hidden', 'removed'].includes(row.status) ? '' : row.body,
          platformBlocked: row.platformHeld || ['hidden', 'removed'].includes(row.status),
          createdAt: row.createdAt.toISOString(),
        })),
      nextCursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  @Transactional('content')
  async decide(commentId: string, userId: string, decision: 'approve' | 'reject') {
    const [initial] = await this.db.select().from(comments).where(eq(comments.id, commentId));
    if (!initial || initial.deletedAt) throw new NotFoundException('Không tìm thấy bình luận');
    const post = await this.ownedPost(initial.postId, userId);
    const [record] = await this.db.select().from(comments).where(eq(comments.id, commentId)).for('update');
    if (!record || record.deletedAt) throw new NotFoundException('Không tìm thấy bình luận');
    const next = decision === 'approve' ? 'approved' : 'rejected';
    if (record.creatorReview === next) return { id: commentId, creatorReview: next, status: record.status };
    if (record.creatorReview !== 'pending') throw new ConflictException('Bình luận đã được xử lý');
    const publish =
      decision === 'approve' &&
      record.status === 'held' &&
      !record.platformHeld &&
      post.status === 'published';
    if (publish && record.parentCommentId) {
      const [parent] = await this.db.select().from(comments).where(eq(comments.id, record.parentCommentId));
      if (!parent || parent.deletedAt || parent.status !== 'visible')
        throw new ConflictException('Bình luận gốc chưa hiển thị');
    }
    await this.db
      .update(comments)
      .set({
        creatorReview: next,
        ...(publish
          ? {
              status: 'visible' as const,
              publishedAt: record.publishedAt ?? new Date(),
              hiddenByActionId: null,
              cascadeRootCommentId: null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(comments.id, commentId));
    if (publish) {
      await this.publishComment(record, post, Boolean(record.publishedAt));
      // Only release replies held by this edit; keep independent creator/platform restrictions.
      if (!record.parentCommentId && record.hiddenByActionId) {
        const children = await this.db
          .update(comments)
          .set({
            status: 'visible',
            hiddenByActionId: null,
            cascadeRootCommentId: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(comments.parentCommentId, record.id),
              eq(comments.cascadeRootCommentId, record.id),
              eq(comments.hiddenByActionId, record.hiddenByActionId),
              eq(comments.status, 'held'),
              eq(comments.creatorReview, 'approved'),
              eq(comments.platformHeld, false),
              isNull(comments.deletedAt),
            ),
          )
          .returning();
        for (const child of children) await this.publishComment(child, post, true);
      }
    }
    return { id: commentId, creatorReview: next, status: publish ? 'visible' : record.status };
  }

  private async publishComment(record: typeof comments.$inferSelect, post: PostRecord, restored: boolean) {
    await this.db
      .update(posts)
      .set({ commentCount: sql`${posts.commentCount} + 1`, updatedAt: new Date() })
      .where(eq(posts.id, post.id));
    let parentAuthorId: string | null = null;
    if (record.parentCommentId)
      parentAuthorId =
        (
          await this.db
            .select({ authorId: comments.authorId })
            .from(comments)
            .where(eq(comments.id, record.parentCommentId))
        )[0]?.authorId ?? null;
    await this.outbox.add({
      type: restored ? 'content.comment.restored' : 'content.comment.created',
      userId: post.authorId,
      payload: {
        postId: post.id,
        postAuthorId: post.authorId,
        postVisibility: post.visibility,
        commentId: record.id,
        authorId: record.authorId,
        parentCommentId: record.parentCommentId,
        parentCommentAuthorId: parentAuthorId,
        body: record.body,
        createdAt: new Date().toISOString(),
      },
    });
  }
}
