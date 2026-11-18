import type { ContentGatePort } from '../ports/content-gate.port.js';
import { ForbiddenException } from '@nestjs/common';
import { matchesCommentKeywords } from '../../domain/comment-filter.js';
import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException, Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { PostCounterDeltaRepository } from '../../infra/post-counter-delta.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord, PostRecord } from '../../../db/schema/index.js';
import { commentPublicationPayload } from '../common/comment-publication.js';

export interface AddCommentCommand {
  postId: string;
  authorId: string;
  body: string;
  parentCommentId?: string;
}

interface CommentThread {
  root: CommentRecord;
  parent: CommentRecord;
}

type PostLock = { kind: 'locked'; post: PostRecord | null } | { kind: 'busy' };

interface PreparedComment {
  shouldHold: boolean;
  thread: CommentThread | null;
  authorDisplayName?: string;
  replyToName?: string;
}

export class AddCommentUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly commentRepository: CommentRepository,
    private readonly outbox: ContentOutbox,
    private readonly userDirectory?: UserDirectoryPort,
    private readonly gate?: ContentGatePort,
    // Không có (test dựng tay) thì luôn chờ khoá dòng bài như bước 1.
    private readonly counterDeltas?: PostCounterDeltaRepository,
  ) {}

  async execute(command: AddCommentCommand): Promise<CommentRecord> {
    const body = Comment.validateBody(command.body);
    const shouldHold = this.gate?.precheck(body).shouldHold ?? false;

    // Đọc, kiểm và tra tên trước khi khoá dòng bài: trong khoá chỉ còn phần ghi (TF99).
    // Bài và luồng được kiểm lại sau khi khoá, vì có thể vừa bị ẩn, xoá trong lúc chuẩn bị.
    this.assertCanComment(await this.postRepository.findById(command.postId), command);
    const thread = command.parentCommentId
      ? await this.findThread(command.postId, command.parentCommentId)
      : null;
    const displayIds = thread ? [command.authorId, thread.parent.authorId] : [command.authorId];
    const names = await this.userDirectory?.getDisplayNames(displayIds).catch(() => undefined);

    return this.createInTransaction(
      { ...command, body },
      {
        shouldHold,
        thread,
        authorDisplayName: names?.get(command.authorId)?.trim(),
        replyToName: thread ? names?.get(thread.parent.authorId)?.trim() : undefined,
      },
    );
  }

  @Transactional('content')
  protected async createInTransaction(
    command: AddCommentCommand,
    prepared: PreparedComment,
  ): Promise<CommentRecord> {
    // Bài vắng: lấy được khoá dòng bài ngay thì cộng đếm luôn (câu đầu vừa khoá vừa cộng), giữ thứ tự "khoá bài
    // trước" như xoá bình luận và kiểm duyệt. Kiểm không đạt thì ném lỗi, rollback huỷ cả phần cộng đếm.
    const lock = await this.lockPostForComment(command.postId, prepared.shouldHold);
    const lockedPost =
      lock.kind === 'locked' ? await this.assertStillCommentable(lock.post, command, prepared.thread) : null;
    const threadRootId = prepared.thread?.root.id ?? null;
    const parentCommentAuthorId = prepared.thread?.root.authorId ?? null;
    const replyToAuthorId = prepared.thread?.parent.authorId ?? null;
    const { authorDisplayName, replyToName } = prepared;
    let shouldHold = prepared.shouldHold;
    const body = command.body;
    const settingsPost = lockedPost ?? (await this.postRepository.findById(command.postId));
    this.assertCanComment(settingsPost, command);
    const creatorHeld =
      command.authorId !== settingsPost.authorId &&
      matchesCommentKeywords(body, settingsPost.commentKeywords ?? []);
    shouldHold ||= creatorHeld;
    if (creatorHeld && !prepared.shouldHold && lockedPost) {
      await this.postRepository.incrementCounter(command.postId, 'commentCount', -1);
    }

    let comment = await this.commentRepository.create({
      postId: command.postId,
      authorId: command.authorId,
      parentCommentId: threadRootId,
      replyToCommentId: command.parentCommentId ?? null,
      authorDisplayName: authorDisplayName ?? null,
      ...(replyToName ? { replyToName } : {}),
      body,
      isEdited: false,
      status: shouldHold ? 'held' : 'visible',
      creatorReview: creatorHeld ? 'pending' : 'approved',
      platformHeld: prepared.shouldHold,
      publishedAt: shouldHold ? null : new Date(),
    });

    // Bài đông (dòng bài đang bị giữ): không chờ. Từ lúc INSERT, khoá ngoại giữ nhẹ dòng bài (KEY SHARE) nên ẩn, xoá
    // cả luồng đến sau phải chờ lượt này; cái gì đã xong trước đó thì đọc lại ở đây thấy, không đạt thì rollback.
    // Số đếm ghi vào bảng đệm, FlushCommentCountsUseCase cộng sau khoảng 1 giây (TF99).
    let post = lockedPost;
    if (!post) {
      post = await this.assertStillCommentable(
        await this.postRepository.findById(command.postId),
        command,
        prepared.thread,
      );
      // The FK now holds the post stable; settings may have changed while INSERT waited.
      if (
        !creatorHeld &&
        command.authorId !== post.authorId &&
        matchesCommentKeywords(body, post.commentKeywords ?? [])
      ) {
        shouldHold = true;
        comment = await this.commentRepository.update(comment.id, {
          status: 'held',
          creatorReview: 'pending',
          publishedAt: null,
        });
      }
      if (!shouldHold) await this.counterDeltas!.addCommentDelta(command.postId, 1);
    }

    // Ghi sự kiện outbox content.comment.created trong cùng transaction DB (phục vụ notification)
    await this.outbox.add({
      type: shouldHold ? 'content.comment.held' : 'content.comment.created',
      userId: command.authorId,
      payload: commentPublicationPayload(
        { ...comment, replyToCommentId: command.parentCommentId ?? null, authorDisplayName },
        post,
        { parentCommentAuthorId, replyToAuthorId },
        comment.createdAt.toISOString(),
      ),
    });

    return comment;
  }

  private async lockPostForComment(postId: string, shouldHold: boolean): Promise<PostLock> {
    // Bình luận bị giữ chờ duyệt không cộng đếm: chỉ khoá như cũ.
    if (shouldHold) return { kind: 'locked', post: await this.postRepository.findByIdForUpdate(postId) };
    if (!this.counterDeltas) {
      return {
        kind: 'locked',
        post: await this.postRepository.lockAndIncrementCounter(postId, 'commentCount', 1),
      };
    }
    const result = await this.postRepository.tryLockAndIncrementCounter(postId, 'commentCount', 1);
    if (result.status === 'busy') return { kind: 'busy' };
    return { kind: 'locked', post: result.status === 'locked' ? result.post : null };
  }

  /** Bài và luồng có thể vừa bị ẩn, xoá trong lúc chuẩn bị: kiểm lại khi đã chắc không ai đổi được nữa. */
  private async assertStillCommentable(
    post: PostRecord | null,
    command: AddCommentCommand,
    thread: CommentThread | null,
  ): Promise<PostRecord> {
    this.assertCanComment(post, command);
    if (!thread) return post;
    const { root, parent } = thread;
    this.assertReplyTarget(await this.commentRepository.findById(root.id), command.postId, parent.id);
    if (parent.id !== root.id)
      this.assertReplyTarget(await this.commentRepository.findById(parent.id), command.postId, parent.id);
    return post;
  }

  /** Người dùng chỉ bình luận được bài mình xem được (chặn draft, private, removed, hidden, held). */
  private assertCanComment(post: PostRecord | null, command: AddCommentCommand): asserts post is PostRecord {
    if (!post) throw new PostNotFoundException(command.postId);
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (post.status === 'held' || !domainPost.canBeViewedBy(command.authorId)) {
      throw new PostNotFoundException(command.postId);
    }
    if (post.commentsEnabled === false)
      throw new ForbiddenException({ code: 'comments_disabled', message: 'Chủ bài đã tắt bình luận.' });
  }

  private assertReplyTarget(
    comment: CommentRecord | null,
    postId: string,
    parentCommentId: string,
  ): asserts comment is CommentRecord {
    if (!comment || comment.postId !== postId || comment.deletedAt || comment.status !== 'visible') {
      throw new CommentNotFoundException(parentCommentId);
    }
  }

  /** Lưu lượt trả lời dưới gốc để giữ phân trang một cấp; event giữ tác giả của mục được trả lời. */
  private async findThread(postId: string, parentCommentId: string): Promise<CommentThread> {
    const parent = await this.commentRepository.findById(parentCommentId);
    this.assertReplyTarget(parent, postId, parentCommentId);
    const root = parent.parentCommentId
      ? await this.commentRepository.findById(parent.parentCommentId)
      : parent;
    this.assertReplyTarget(root, postId, parentCommentId);
    Comment.validateParentForReply(root);
    return { root, parent };
  }
}
