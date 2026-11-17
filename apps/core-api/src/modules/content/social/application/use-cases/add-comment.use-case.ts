import type { ContentGatePort } from '../ports/content-gate.port.js';
import { Transactional } from '@tripflix/db';
import { Comment, CommentNotFoundException, Post, PostNotFoundException } from '../../domain/index.js';
import { CommentRepository } from '../../infra/comment.repository.js';
import { PostRepository } from '../../infra/post.repository.js';
import type { UserDirectoryPort } from '../ports/user-directory.port.js';
import type { ContentOutbox } from '../ports/content-outbox.port.js';
import type { CommentRecord, PostRecord } from '../../../db/schema/index.js';

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
  protected async createInTransaction(command: AddCommentCommand, prepared: PreparedComment): Promise<CommentRecord> {
    // Câu đầu tiên khoá dòng bài (vừa khoá vừa cộng đếm), giữ thứ tự "khoá bài trước" như xoá bình luận và
    // kiểm duyệt: ẩn, xoá cả luồng phải chờ lượt thêm này xong, không ai chen trả lời vào giữa lúc cascade.
    // Kiểm không đạt thì ném lỗi, transaction rollback nên phần cộng đếm cũng bị huỷ.
    const post = prepared.shouldHold
      ? await this.postRepository.findByIdForUpdate(command.postId)
      : await this.postRepository.lockAndIncrementCounter(command.postId, 'commentCount', 1);
    this.assertCanComment(post, command);

    if (prepared.thread) {
      const { root, parent } = prepared.thread;
      // Sau khi khoá bài, không ai xoá, ẩn được gốc hay mục được trả lời nữa: kiểm lại một lần là đủ.
      this.assertReplyTarget(await this.commentRepository.findById(root.id), command.postId, parent.id);
      if (parent.id !== root.id)
        this.assertReplyTarget(await this.commentRepository.findById(parent.id), command.postId, parent.id);
    }
    const threadRootId = prepared.thread?.root.id ?? null;
    const parentCommentAuthorId = prepared.thread?.root.authorId ?? null;
    const replyToAuthorId = prepared.thread?.parent.authorId ?? null;
    const { authorDisplayName, replyToName, shouldHold } = prepared;
    const body = command.body;

    const comment = await this.commentRepository.create({
      postId: command.postId,
      authorId: command.authorId,
      parentCommentId: threadRootId,
      ...(replyToName ? { replyToName } : {}),
      body,
      isEdited: false,
      status: shouldHold ? 'held' : 'visible',
    });

    // Ghi sự kiện outbox content.comment.created trong cùng transaction DB (phục vụ notification)
    await this.outbox.add({
      type: shouldHold ? 'content.comment.held' : 'content.comment.created',
      userId: command.authorId,
      payload: {
        commentId: comment.id,
        postId: command.postId,
        postAuthorId: post.authorId,
        // notification chỉ phát realtime vào phòng của bài khi biết bài public (TF99, TF101).
        postVisibility: post.visibility,
        authorId: command.authorId,
        ...(authorDisplayName ? { authorDisplayName } : {}),
        parentCommentId: threadRootId,
        parentCommentAuthorId,
        ...(command.parentCommentId ? { replyToCommentId: command.parentCommentId, replyToAuthorId } : {}),
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      },
    });

    return comment;
  }

  /** Người dùng chỉ bình luận được bài mình xem được (chặn draft, private, removed, hidden, held). */
  private assertCanComment(post: PostRecord | null, command: AddCommentCommand): asserts post is PostRecord {
    if (!post) throw new PostNotFoundException(command.postId);
    const domainPost = new Post({ ...post, coverMediaId: post.coverMediaId ?? undefined });
    if (post.status === 'held' || !domainPost.canBeViewedBy(command.authorId)) {
      throw new PostNotFoundException(command.postId);
    }
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
    const root = parent.parentCommentId ? await this.commentRepository.findById(parent.parentCommentId) : parent;
    this.assertReplyTarget(root, postId, parentCommentId);
    Comment.validateParentForReply(root);
    return { root, parent };
  }
}
