import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { comments, moderationActions, type ModerationTarget } from '../../db/schema/index.js';
import { PostRepository } from '../../social/infra/post.repository.js';
import type { ContentOutbox } from '../../social/application/ports/content-outbox.port.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { AdminModeratePostUseCase } from '../../social/application/use-cases/admin-moderate-post.use-case.js';
import { MODERATION_POLICY_VERSION } from '../domain/content-version.js';

export interface ChangeVisibilityCommand {
  actorIsSuperAdmin?: boolean;
  targetType: ModerationTarget;
  targetId: string;
  action: 'hide' | 'restore' | 'remove' | 'dismiss';
  actorId: string;
  actorType: 'staff' | 'system';
  reasonCode: string;
  reasonDetail?: string;
  caseId?: string;
}
export class ChangeVisibilityUseCase {
  constructor(
    private readonly repository: ModerationRepository,
    private readonly postRepository: PostRepository,
    private readonly outbox: ContentOutbox,
    private readonly moderatePost: AdminModeratePostUseCase,
  ) {}

  @Transactional('content')
  async execute(command: ChangeVisibilityCommand) {
    const initial = await this.repository.loadTarget(command.targetType, command.targetId);
    if (!initial) throw new NotFoundException('Không tìm thấy nội dung');
    const parentPost = await this.repository.lockPost(initial.postId);
    const lockedTarget = await this.repository.loadTarget(command.targetType, command.targetId);
    if (command.action === 'dismiss' && lockedTarget?.status === 'held' && !lockedTarget.deleted) {
      command = { ...command, action: 'restore' };
    }
    if (
      command.targetType === 'comment' &&
      command.action === 'restore' &&
      parentPost?.status !== 'published'
    )
      throw new ConflictException('Bài viết chứa bình luận chưa hiển thị');
    const target = await this.repository.loadTarget(command.targetType, command.targetId);
    if (
      !target ||
      (command.action !== 'dismiss' &&
        (target.deleted ||
          target.status === 'deleted' ||
          (target.targetType === 'comment' && target.status === 'removed' && command.action !== 'restore')))
    )
      throw new ConflictException('Nội dung đã bị xoá, không thể khôi phục hoặc kiểm duyệt lại');
    let previouslyAutoHidden = false;
    let actionId: string = randomUUID();
    const changes: {
      id: string;
      authorId: string;
      body: string;
      parentCommentId: string | null;
      previousStatus: string;
      wasPublic: boolean;
      status: string;
    }[] = [];
    let newStatus = target.status;
    if (command.targetType === 'post') {
      newStatus =
        command.action === 'dismiss'
          ? target.status
          : command.action === 'restore'
            ? 'published'
            : command.action === 'remove'
              ? 'removed'
              : 'hidden';
      if (command.action !== 'dismiss' && !['published', 'held', 'hidden', 'removed'].includes(target.status))
        throw new ConflictException('Chỉ kiểm duyệt bài đã đăng');
      if (target.status === 'removed' && !['restore', 'dismiss'].includes(command.action))
        throw new ConflictException('Bài đã gỡ chỉ có thể khôi phục');
      if (command.action !== 'dismiss') {
        const result = await this.moderatePost.execute({
          postId: target.targetId,
          moderatorId: command.actorId,
          action: command.action,
          actorType: command.actorType,
          caseId: command.caseId,
          reasonCode: command.reasonCode,
          reasonDetail: command.reasonDetail,
        });
        actionId = result.actionId;
        newStatus = result.postStatus;
      }
    } else if (command.action !== 'dismiss') {
      const db = this.repository.db;
      const [root] = await db.select().from(comments).where(eq(comments.id, target.targetId));
      if (!root) throw new NotFoundException('Không tìm thấy bình luận');
      if (command.action === 'restore' && root.status === 'hidden' && root.hiddenByActionId) {
        const [hideAction] = await db
          .select({ action: moderationActions.action })
          .from(moderationActions)
          .where(eq(moderationActions.id, root.hiddenByActionId));
        previouslyAutoHidden = hideAction?.action === 'auto_hide';
      }
      if (command.action === 'restore' && root.parentCommentId) {
        const [parent] = await db.select().from(comments).where(eq(comments.id, root.parentCommentId));
        if (!parent || parent.status !== 'visible' || parent.deletedAt)
          throw new ConflictException('Bình luận gốc chưa hiển thị');
      }
      newStatus =
        command.action === 'restore' ? 'visible' : command.action === 'remove' ? 'removed' : 'hidden';
      const scope = root.parentCommentId
        ? eq(comments.id, root.id)
        : or(eq(comments.id, root.id), eq(comments.parentCommentId, root.id));
      const records = await db
        .select()
        .from(comments)
        .where(and(scope, isNull(comments.deletedAt)))
        .orderBy(comments.id)
        .for('update');
      for (const record of records) {
        const isChild = record.id !== root.id;
        // Giữ quyết định riêng của reply khi gỡ cả luồng; restore gốc không được bỏ quyết định đó.
        if (
          isChild &&
          command.action === 'remove' &&
          ['hidden', 'held'].includes(record.status) &&
          (record.cascadeRootCommentId !== root.id || record.hiddenByActionId !== root.hiddenByActionId)
        )
          continue;
        if (
          command.action === 'restore' &&
          (!['held', 'hidden', 'removed'].includes(record.status) ||
            (isChild &&
              (!root.hiddenByActionId ||
                record.hiddenByActionId !== root.hiddenByActionId ||
                record.cascadeRootCommentId !== root.id)))
        )
          continue;
        if (isChild && record.status === 'held' &&
          (record.cascadeRootCommentId !== root.id || record.hiddenByActionId !== root.hiddenByActionId)) continue;
        if (command.action === 'hide' && !['visible', 'held'].includes(record.status)) {
          // Một quyết định ẩn riêng sau cascade phải ngăn lần restore gốc hiện lại phản hồi đó.
          if (!isChild && record.status === 'hidden' && record.cascadeRootCommentId) {
            await db
              .update(comments)
              .set({ hiddenByActionId: actionId, cascadeRootCommentId: null })
              .where(
                and(eq(comments.id, record.id), eq(comments.status, 'hidden'), isNull(comments.deletedAt)),
              );
          }
          continue;
        }
        const creatorRestricted = (record.creatorReview && record.creatorReview !== 'approved') ||
          (isChild && root.creatorReview && root.creatorReview !== 'approved');
        const recordStatus = command.action === 'restore' && creatorRestricted ? 'held' : newStatus;
        if ((record.status === 'removed' && command.action !== 'restore') || (record.status === recordStatus && command.action !== 'restore'))
          continue;
        const [updated] = await db
          .update(comments)
          .set({
            status: recordStatus as 'visible' | 'held' | 'hidden' | 'removed',
            ...(command.action === 'restore' ? { platformHeld: false } : {}),
            ...(recordStatus === 'visible' ? { publishedAt: record.publishedAt ?? new Date() } : {}),
            updatedAt: new Date(),
            deletedAt: null,
            hiddenByActionId: ['hide', 'remove'].includes(command.action) ? actionId : recordStatus === 'held' ? record.hiddenByActionId : null,
            cascadeRootCommentId: ['hide', 'remove'].includes(command.action) && isChild ? root.id : recordStatus === 'held' ? record.cascadeRootCommentId : null,
          })
          .where(
            and(eq(comments.id, record.id), eq(comments.status, record.status), isNull(comments.deletedAt)),
          )
          .returning();
        if (updated)
          changes.push({
            id: updated.id,
            authorId: updated.authorId,
            body: updated.body,
            parentCommentId: updated.parentCommentId,
            previousStatus: record.status,
            wasPublic: record.publishedAt === undefined ? Boolean(record.hiddenByActionId) : Boolean(record.publishedAt),
            status: updated.status,
          });
      }
      const delta = changes.reduce(
        (sum, row) => sum + (row.status === 'visible' ? 1 : 0) - (row.previousStatus === 'visible' ? 1 : 0),
        0,
      );
      if (delta) await this.postRepository.incrementCounter(target.postId, 'commentCount', delta);
      newStatus = (await this.repository.loadTarget(command.targetType, command.targetId))?.status ?? newStatus;
    }
    if (target.targetType === 'comment' || command.action === 'dismiss')
      await this.repository.db.insert(moderationActions).values({
        id: actionId,
        postId: target.postId,
        targetType: target.targetType,
        commentId: target.targetType === 'comment' ? target.targetId : null,
        moderatorId: command.actorId,
        actorType: command.actorType,
        caseId: command.caseId,
        action: command.actorType === 'system' && command.action === 'hide' ? 'auto_hide' : command.action,
        previousStatus: target.status as 'visible' | 'published' | 'hidden',
        postStatus: newStatus as 'visible' | 'published' | 'hidden' | 'removed',
        reasonCode: command.reasonCode,
        reasonDetail: command.reasonDetail,
      });
    const decidedTarget = await this.repository.loadTarget(command.targetType, command.targetId);
    if (decidedTarget)
      await this.repository.db
        .update(moderationActions)
        .set({
          contentVersion: decidedTarget.version,
          policyVersion: MODERATION_POLICY_VERSION,
          evidenceSnapshot: {
            text: decidedTarget.text,
            coverMediaId: decidedTarget.coverMediaId,
            mediaIds: decidedTarget.mediaIds,
          },
        })
        .where(eq(moderationActions.id, actionId));
    for (const row of changes) {
      // postVisibility để notification phát tín hiệu realtime vào phòng của bài public (TF99, TF101):
      // người đang xem thấy bình luận bị ẩn biến mất mà không cần tải lại.
      const payload = {
        postId: target.postId,
        commentId: row.id,
        authorId: row.authorId,
        ...(parentPost ? { postVisibility: parentPost.visibility } : {}),
      };
      await this.outbox.add({
        type:
          row.previousStatus === 'held' && !row.wasPublic && row.status === 'visible'
            ? 'content.comment.created'
            : row.status === 'visible'
            ? 'content.comment.restored'
            : row.status === 'removed'
              ? 'content.comment.deleted'
              : 'content.comment.hidden',
        userId: command.actorId,
        payload:
          row.status === 'visible'
            ? {
                ...payload,
                body: row.body,
                parentCommentId: row.parentCommentId,
                postAuthorId: parentPost?.authorId,
                ...(row.previousStatus === 'held' && !row.wasPublic ? {
                  createdAt: new Date().toISOString(),
                  parentCommentAuthorId: row.parentCommentId
                    ? (await this.repository.db.select({ authorId: comments.authorId }).from(comments)
                        .where(eq(comments.id, row.parentCommentId)))[0]?.authorId ?? null : null,
                } : {}),
              }
            : row.status === 'removed'
              ? {
                  ...payload,
                  parentCommentId: row.parentCommentId,
                  deletedBy: command.actorId,
                  isSuperAdmin: command.actorIsSuperAdmin ?? false,
                  deletedAt: new Date().toISOString(),
                }
              : payload,
      });
    }
    if (command.caseId)
      await this.outbox.add({
        type: 'content.moderation.decided',
        userId: command.actorId,
        payload: {
          caseId: command.caseId,
          targetType: target.targetType,
          targetId: target.targetId,
          postId: target.postId,
          authorId: target.authorId,
          action: command.action,
          reasonCode: command.reasonCode,
          isAutomatic: command.actorType === 'system',
          resultingStatus: newStatus,
          ...(previouslyAutoHidden ? { previouslyAutoHidden: true } : {}),
        },
      });
    if (
      !command.caseId &&
      target.targetType === 'comment' &&
      command.action !== 'dismiss' &&
      changes.some((row) => row.id === target.targetId)
    )
      await this.outbox.add({
        type: 'content.comment.moderation_action',
        userId: command.actorId,
        payload: {
          actionId,
          postId: target.postId,
          commentId: target.targetId,
          authorId: target.authorId,
          action: command.action,
          reasonCode: command.reasonCode,
          resultingStatus: newStatus,
          ...(previouslyAutoHidden ? { previouslyAutoHidden: true } : {}),
        },
      });
    return { actionId, changedCount: changes.length, previousStatus: target.status, status: newStatus };
  }
}
