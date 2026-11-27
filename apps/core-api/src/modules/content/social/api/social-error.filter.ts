import { Catch, HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { DATABASE_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS, isDatabaseUnavailable } from '../../../commerce/index.js';
import {
  CommentNotFoundException,
  DomainException,
  InvalidCommentBodyException,
  InvalidCommentMentionsException,
  InvalidPostStatusTransitionException,
  PostNotFoundException,
  UnauthorizedCommentActionException,
  UnauthorizedPostActionException,
} from '../domain/errors.js';

/**
 * Lỗi nghiệp vụ ra mã HTTP rõ ràng thay vì 500 chung chung.
 * Database không phục vụ được (chờ mượn kết nối pool quá hạn khi quá tải, mất kết nối) thì trả 503 kèm Retry-After:
 * client biết là lỗi tạm, thử lại sau (TF99: quá tải trên staging từng ra 500). Lỗi khác để Nest xử lý như cũ.
 */
@Catch()
export class SocialErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('SocialErrorFilter');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof DomainException) {
      const status = statusOf(exception);
      res.status(status).json({ statusCode: status, message: exception.message });
      return;
    }
    if (isDatabaseUnavailable(exception)) {
      this.logger.warn({ err: exception }, 'Database không phục vụ được, trả 503');
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: DATABASE_UNAVAILABLE_MESSAGE,
        reason: 'SERVICE_UNAVAILABLE',
        error: 'Service Unavailable',
      });
      return;
    }
    super.catch(exception, host);
  }
}

function statusOf(error: DomainException): number {
  if (error instanceof PostNotFoundException || error instanceof CommentNotFoundException) return 404;
  if (error instanceof UnauthorizedPostActionException || error instanceof UnauthorizedCommentActionException) return 403;
  if (error instanceof InvalidPostStatusTransitionException) return 409;
  if (error instanceof InvalidCommentBodyException || error instanceof InvalidCommentMentionsException) return 400;
  return 422;
}
