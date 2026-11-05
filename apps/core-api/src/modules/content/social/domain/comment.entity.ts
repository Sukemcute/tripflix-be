import {
  InvalidCommentNestingException,
  UnauthorizedCommentActionException,
} from './errors.js';

export interface CommentProps {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId?: string | null;
  body: string;
  isEdited: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

/**
 * Thực thể bình luận (Comment Domain Entity).
 */
export class Comment {
  private props: CommentProps;

  constructor(props: CommentProps) {
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get postId(): string { return this.props.postId; }
  get authorId(): string { return this.props.authorId; }
  get parentCommentId(): string | null | undefined { return this.props.parentCommentId; }
  get body(): string { return this.props.body; }
  get isEdited(): boolean { return this.props.isEdited; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }
  get deletedAt(): Date | null | undefined { return this.props.deletedAt; }

  /** Kiểm tra tính hợp lệ khi làm reply (chỉ cho phép 1 cấp, không được lồng cấp 2) */
  static validateParentForReply(parent: { parentCommentId?: string | null }): void {
    if (parent.parentCommentId) {
      throw new InvalidCommentNestingException();
    }
  }

  isOwnedBy(userId: string): boolean {
    return this.props.authorId === userId;
  }

  updateBody(userId: string, newBody: string): void {
    if (!this.isOwnedBy(userId)) {
      throw new UnauthorizedCommentActionException('chỉnh sửa', this.id);
    }
    const trimmed = newBody.trim();
    if (!trimmed) {
      throw new Error('Nội dung bình luận không được để trống');
    }
    this.props.body = trimmed;
    this.props.isEdited = true;
    this.props.updatedAt = new Date();
  }

  softDelete(userId: string, isSuperAdmin = false): void {
    if (!this.isOwnedBy(userId) && !isSuperAdmin) {
      throw new UnauthorizedCommentActionException('xóa', this.id);
    }
    this.props.deletedAt = new Date();
    this.props.updatedAt = new Date();
  }

  toRaw(): CommentProps {
    return { ...this.props };
  }
}
