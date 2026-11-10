import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { comments, moderationActions, type ModerationTarget } from '../../db/schema/index.js';
import { PostRepository } from '../../social/infra/post.repository.js';
import type { ContentOutbox } from '../../social/application/ports/content-outbox.port.js';
import { ModerationRepository } from '../infra/moderation.repository.js';
import { AdminModeratePostUseCase } from '../../social/application/use-cases/admin-moderate-post.use-case.js';

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
    await this.repository.lockPost(initial.postId);
    const target = await this.repository.loadTarget(command.targetType, command.targetId);
    if (
      !target ||
      (command.action !== 'dismiss' &&
        (target.deleted ||
          target.status === 'deleted' ||
          (target.targetType === 'comment' && target.status === 'removed')))
    )
      throw new ConflictException('Nội dung đã bị xoá, không thể khôi phục hoặc kiểm duyệt lại');
    let actionId: string = randomUUID();
    const changes: {
      id: string;
      authorId: string;
      parentCommentId: string | null;
      previousStatus: string;
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
      if (command.action !== 'dismiss' && !['published', 'hidden', 'removed'].includes(target.status))
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
        if (
          command.action === 'restore' &&
          (record.status !== 'hidden' ||
            (isChild &&
              (!root.hiddenByActionId ||
                record.hiddenByActionId !== root.hiddenByActionId ||
                record.cascadeRootCommentId !== root.id)))
        )
          continue;
        if (command.action === 'hide' && record.status !== 'visible') {
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
        if (record.status === 'removed' || record.status === newStatus) continue;
        const updated = await db
          .update(comments)
          .set({
            status: newStatus as 'visible' | 'hidden' | 'removed',
            updatedAt: new Date(),
            deletedAt: command.action === 'remove' ? new Date() : null,
            hiddenByActionId: command.action === 'hide' ? actionId : null,
            cascadeRootCommentId: command.action === 'hide' && isChild ? root.id : null,
          })
          .where(
            and(eq(comments.id, record.id), eq(comments.status, record.status), isNull(comments.deletedAt)),
          )
          .returning();
        if (updated.length)
          changes.push({
            id: record.id,
            authorId: record.authorId,
            parentCommentId: record.parentCommentId,
            previousStatus: record.status,
            status: newStatus,
          });
      }
      const delta = changes.reduce(
        (sum, row) => sum + (row.status === 'visible' ? 1 : 0) - (row.previousStatus === 'visible' ? 1 : 0),
        0,
      );
      if (delta) await this.postRepository.incrementCounter(target.postId, 'commentCount', delta);
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
    for (const row of changes) {
      await this.outbox.add({
        type:
          row.status === 'visible'
            ? 'content.comment.restored'
            : row.status === 'removed'
              ? 'content.comment.deleted'
              : 'content.comment.hidden',
        userId: command.actorId,
        payload:
          row.status === 'removed'
            ? {
                postId: target.postId,
                commentId: row.id,
                authorId: row.authorId,
                parentCommentId: row.parentCommentId,
                deletedBy: command.actorId,
                isSuperAdmin: command.actorIsSuperAdmin ?? false,
                deletedAt: new Date().toISOString(),
              }
            : { postId: target.postId, commentId: row.id, authorId: row.authorId },
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
        },
      });
    return { actionId, changedCount: changes.length, previousStatus: target.status, status: newStatus };
  }
}
