import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import {
  CommentNotFoundException,
  DomainException,
  InvalidPostStatusTransitionException,
  PostNotFoundException,
  UnauthorizedCommentActionException,
  UnauthorizedPostActionException,
} from '../domain/errors.js';

/** Domain errors must reach clients as actionable HTTP errors rather than generic 500s. */
@Catch(DomainException)
export class SocialErrorFilter implements ExceptionFilter<DomainException> {
  catch(error: DomainException, host: ArgumentsHost): void {
    const status =
      error instanceof PostNotFoundException || error instanceof CommentNotFoundException
        ? 404
        : error instanceof UnauthorizedPostActionException ||
            error instanceof UnauthorizedCommentActionException
          ? 403
          : error instanceof InvalidPostStatusTransitionException
            ? 409
            : 422;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message: error.message });
  }
}
