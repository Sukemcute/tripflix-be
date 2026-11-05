import 'reflect-metadata';
import { Controller, Get, UseFilters, type INestApplication } from '@nestjs/common';
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
    throw new InvalidCommentBodyException('Nội dung bình luận không được vượt quá 10,000 ký tự');
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
    message: expect.stringContaining('10,000 ký tự'),
  });
});
