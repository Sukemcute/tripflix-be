import 'reflect-metadata';
import { BadRequestException, Controller, Get, UseFilters, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  PostNotFoundException,
  PostPublishValidationException,
  UnauthorizedPostActionException,
  InvalidPostStatusTransitionException,
  InvalidCommentBodyException,
} from '../domain/errors.js';
import { SocialErrorFilter } from './social-error.filter.js';

@Controller('social-errors')
@UseFilters(SocialErrorFilter)
class ErrorController {
  @Get('hidden') hidden() {
    throw new PostNotFoundException('hidden-post');
  }
  @Get('forbidden') forbidden() {
    throw new UnauthorizedPostActionException('sửa', 'another-post');
  }
  @Get('invalid') invalid() {
    throw new PostPublishValidationException('Nội dung trống');
  }
  @Get('conflict') conflict() {
    throw new InvalidPostStatusTransitionException('published', 'published');
  }
  @Get('invalid-comment-body') invalidCommentBody() {
    throw new InvalidCommentBodyException('Nội dung bình luận không được vượt quá 2,000 ký tự');
  }
  @Get('pool-timeout') poolTimeout() {
    // Drizzle bọc lỗi của pg trong cause, như khi chờ mượn kết nối pool quá connectionTimeoutMillis.
    throw new Error('Failed query', { cause: new Error('timeout exceeded when trying to connect') });
  }
  @Get('bad-request') badRequest() {
    throw new BadRequestException('Thiếu nội dung');
  }
  @Get('bug') bug() {
    throw new Error('lỗi code');
  }
}
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [ErrorController] }).compile();
  app = module.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

it('returns 404 instead of 500 for a hidden or missing post', async () => {
  const response = await request(app.getHttpServer()).get('/social-errors/hidden').expect(404);
  expect(response.body).toMatchObject({ statusCode: 404, message: expect.stringContaining('hidden-post') });
});
it('keeps authorization failures actionable for frontend clients', async () => {
  await request(app.getHttpServer()).get('/social-errors/forbidden').expect(403);
});
it('distinguishes invalid publication from a repeated status transition', async () => {
  await request(app.getHttpServer()).get('/social-errors/invalid').expect(422);
  await request(app.getHttpServer()).get('/social-errors/conflict').expect(409);
});
it('returns 400 for invalid comment body instead of 500', async () => {
  const res = await request(app.getHttpServer()).get('/social-errors/invalid-comment-body').expect(400);
  expect(res.body).toMatchObject({
    statusCode: 400,
    message: expect.stringContaining('2,000 ký tự'),
  });
});
it('returns 503 with Retry-After when the database pool times out under load', async () => {
  const res = await request(app.getHttpServer()).get('/social-errors/pool-timeout').expect(503);
  expect(res.headers['retry-after']).toBe('5');
  expect(res.body).toMatchObject({ statusCode: 503, reason: 'SERVICE_UNAVAILABLE' });
});
it('leaves HTTP exceptions and code bugs to Nest as before', async () => {
  await request(app.getHttpServer()).get('/social-errors/bad-request').expect(400);
  await request(app.getHttpServer()).get('/social-errors/bug').expect(500);
});
