import {
  InvalidCommentBodyException,
  InvalidCommentNestingException,
  UnauthorizedCommentActionException,
} from './errors.js';
import { validateCommentMentions, type CommentMention } from './comment-mention.js';

export interface CommentProps {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId?: string | null;
  body: string;
  mentions?: CommentMention[];
  likeCount?: number;
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
    this.props = { ...props, mentions: (props.mentions ?? []).map((mention) => ({ ...mention })) };
  }

  get id(): string { return this.props.id; }
  get postId(): string { return this.props.postId; }
  get authorId(): string { return this.props.authorId; }
  get parentCommentId(): string | null | undefined { return this.props.parentCommentId; }
  get body(): string { return this.props.body; }
  get mentions(): CommentMention[] { return (this.props.mentions ?? []).map((mention) => ({ ...mention })); }
  get likeCount(): number { return this.props.likeCount ?? 0; }
  get isEdited(): boolean { return this.props.isEdited; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }
  get deletedAt(): Date | null | undefined { return this.props.deletedAt; }

  static readonly MAX_BODY_LENGTH = 2_000;

  /** Kiểm tra tính hợp lệ và độ dài nội dung bình luận (1 - 2.000 ký tự) */
  static validateBody(body: string): string {
    if (typeof body !== 'string') throw new InvalidCommentBodyException('Nội dung bình luận phải là chuỗi');
    const trimmed = (body ?? '').trim();
    if (!trimmed) {
      throw new InvalidCommentBodyException('Nội dung bình luận không được để trống');
    }
    if (trimmed.length > Comment.MAX_BODY_LENGTH) {
      throw new InvalidCommentBodyException(`Nội dung bình luận không được vượt quá ${Comment.MAX_BODY_LENGTH.toLocaleString()} ký tự`);
    }
    return trimmed;
  }

  static validateMentions(body: string, mentions: unknown = []): CommentMention[] {
    return validateCommentMentions(body, mentions);
  }

  static prepareContent(body: string, mentions: unknown = []): { body: string; mentions: CommentMention[] } {
    const trimmed = Comment.validateBody(body);
    const leadingWhitespace = body.length - body.trimStart().length;
    const adjusted = Comment.validateMentions(body, mentions).map((mention) => ({
      ...mention, offset: mention.offset - leadingWhitespace,
    }));
    return { body: trimmed, mentions: Comment.validateMentions(trimmed, adjusted) };
  }

  /** Kiểm tra tính hợp lệ khi làm reply (chỉ cho phép 1 cấp, không được lồng cấp 2) */
  static validateParentForReply(parent: { parentCommentId?: string | null }): void {
    if (parent.parentCommentId) {
      throw new InvalidCommentNestingException();
    }
  }

  isOwnedBy(userId: string): boolean {
    return this.props.authorId === userId;
  }

  updateBody(userId: string, newBody: string, mentions: CommentMention[] = this.mentions): void {
    if (!this.isOwnedBy(userId)) {
      throw new UnauthorizedCommentActionException('chỉnh sửa', this.id);
    }
    const content = Comment.prepareContent(newBody, mentions);
    this.props.body = content.body;
    this.props.mentions = content.mentions;
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
    return { ...this.props, mentions: this.mentions };
  }
}
