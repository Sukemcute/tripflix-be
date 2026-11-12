/**
 * Các lỗi nghiệp vụ thuần của phân hệ Social (Domain Exceptions).
 * Không phụ thuộc vào NestJS HttpException hay Drizzle ORM.
 */

export class DomainException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class PostNotFoundException extends DomainException {
  constructor(postId: string) {
    super(`Không tìm thấy bài đăng với ID: ${postId}`);
  }
}

export class UnauthorizedPostActionException extends DomainException {
  constructor(action: string, postId: string) {
    super(`Bạn không có quyền ${action} trên bài đăng ID: ${postId}`);
  }
}

export class InvalidPostStatusTransitionException extends DomainException {
  constructor(fromStatus: string, toStatus: string) {
    super(`Không thể chuyển trạng thái bài đăng từ "${fromStatus}" sang "${toStatus}"`);
  }
}

export class PostPublishValidationException extends DomainException {
  constructor(reason: string) {
    super(`Không thể xuất bản bài đăng: ${reason}`);
  }
}

export class PostMediaNotAllowedException extends DomainException {
  constructor() {
    super('Bài viết (vlog) không được kèm video. Muốn đăng video hãy tạo bài dạng Reels');
  }
}

export class CommentNotFoundException extends DomainException {
  constructor(commentId: string) {
    super(`Không tìm thấy bình luận với ID: ${commentId}`);
  }
}

export class InvalidCommentBodyException extends DomainException {
  constructor(reason: string) {
    super(reason);
  }
}

export class UnauthorizedCommentActionException extends DomainException {
  constructor(action: string, commentId: string) {
    super(`Bạn không có quyền ${action} trên bình luận ID: ${commentId}`);
  }
}

export class InvalidCommentNestingException extends DomainException {
  constructor() {
    super('Chỉ hỗ trợ phản hồi bình luận 1 cấp (không thể phản hồi trên một câu trả lời khác)');
  }
}

export class InvalidReactionTypeException extends DomainException {
  constructor(type: string) {
    super(`Loại cảm xúc không hợp lệ: "${type}". Hỗ trợ: like, love, helpful`);
  }
}
