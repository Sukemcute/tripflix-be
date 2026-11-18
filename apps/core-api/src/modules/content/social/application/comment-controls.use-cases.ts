import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Transactional, type Db } from '@tripflix/db';
import { comments, posts, type PostRecord } from '../../db/schema/index.js';
import type { ContentOutbox } from './ports/content-outbox.port.js';
import { Post } from '../domain/post.entity.js';
import { commentPublicationPayload, loadCommentPublicationContext } from './common/comment-publication.js';
import { decodeCursor, encodeCursor } from './common/cursor.js';
import { isBeforeCursor } from '../infra/keyset-cursor.js';

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
  async queue(postId: string, userId: string, cursor: string | number | undefined, limit: number) {
    const post = await this.ownedPost(postId, userId);
    // Accept cursors from the first release while returning stable keyset cursors to new pages.
    const value = cursor === undefined ? undefined : String(cursor);
    const legacy = value !== undefined && /^\d+$/.test(value);
    const offset = legacy ? Number(value) : 0;
    const decoded = legacy ? undefined : decodeCursor(value);
    if (
      offset > 1000000 ||
      (value &&
        !legacy &&
        (!decoded ||
          !Number.isFinite(decoded.createdAt.getTime()) ||
          !z.uuid().safeParse(decoded.id).success))
    )
      throw new BadRequestException('Cursor hàng chờ không hợp lệ');
    const rows = await this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          eq(comments.creatorReview, 'pending'),
          isNull(comments.deletedAt),
          decoded
            ? isBeforeCursor(comments, comments.createdAt, comments.id, {
                time: decoded.createdAt,
                id: decoded.id,
              })
            : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);
    const contextIds = [
      ...new Set(
        page.flatMap((row) => [row.parentCommentId, row.replyToCommentId]).filter((id): id is string => !!id),
      ),
    ];
    const contexts = contextIds.length
      ? await this.db
          .select()
          .from(comments)
          .where(and(eq(comments.postId, postId), inArray(comments.id, contextIds)))
      : [];
    const byId = new Map(contexts.map((row) => [row.id, row]));
    const last = page.at(-1);
    return {
      items: page.map((row) => {
        const parent = row.parentCommentId ? byId.get(row.parentCommentId) : undefined;
        const approvalBlockReason =
          post.status !== 'published'
            ? ('post_unavailable' as const)
            : row.parentCommentId && (!parent || parent.deletedAt || parent.status !== 'visible')
              ? ('parent_unavailable' as const)
              : null;
        const contextId = row.replyToCommentId ?? row.parentCommentId;
        const context = contextId ? byId.get(contextId) : undefined;
        const contextVisible =
          context &&
          !context.deletedAt &&
          context.status === 'visible' &&
          context.creatorReview === 'approved';
        const platformBlocked = row.platformHeld || ['hidden', 'removed'].includes(row.status);
        return {
          id: row.id,
          postId,
          authorId: row.authorId,
          authorName: row.authorDisplayName,
          parentCommentId: row.parentCommentId,
          body: ['hidden', 'removed'].includes(row.status) ? '' : row.body,
          platformBlocked,
          canApprove: approvalBlockReason === null,
          approvalBlockReason,
          willPublish: approvalBlockReason === null && !platformBlocked && row.status === 'held',
          parentContext: contextId
            ? {
                id: contextId,
                kind: row.replyToCommentId ? ('reply' as const) : ('thread' as const),
                authorName: contextVisible ? context.authorDisplayName : null,
                body: contextVisible ? context.body : null,
                unavailable: !contextVisible,
              }
            : null,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
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
    if (decision === 'approve' && post.status !== 'published')
      throw new ConflictException('Bài viết chưa hiển thị, chưa thể duyệt bình luận');
    if (decision === 'approve' && record.parentCommentId) {
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
    await this.outbox.add({
      type: restored ? 'content.comment.restored' : 'content.comment.created',
      userId: post.authorId,
      payload: commentPublicationPayload(
        record,
        post,
        await loadCommentPublicationContext(this.db, post.id, record),
      ),
    });
  }
}
