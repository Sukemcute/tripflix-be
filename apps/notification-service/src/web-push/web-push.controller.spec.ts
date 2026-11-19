import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AuthModule, InvalidAccessTokenError, MemorySidBlocklist } from '@tripflix/auth';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { envSchema } from '../env.js';
import { ENV } from '../tokens.js';
import { WebPushController } from './web-push.controller.js';
import { WebPushWorker } from './web-push.worker.js';

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  sid: '00000000-0000-4000-8000-000000000002',
  exp: 9999999999,
  role: 'member' as const,
};
const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
const body = {
  endpoint,
  expirationTime: null,
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
    auth: Buffer.alloc(16, 2).toString('base64url'),
  },
};

describe('Web Push HTTP boundary', () => {
  let app: INestApplication;
  const worker = {
    register: vi.fn().mockResolvedValue('00000000-0000-4000-8000-000000000003'),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const env = {
    ...envSchema.parse({ DATABASE_URL_NOTIFICATION: 'test' }),
    WEB_PUSH_ENABLED: true,
    WEB_PUSH_PUBLIC_KEY: 'public-test',
    WEB_PUSH_PRIVATE_KEY: 'private-test',
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AuthModule.forRootAsync({
          useFactory: () => ({
            verifier: async (token: string) => {
              if (token !== 'test-session') throw new InvalidAccessTokenError();
              return user;
            },
            blocklist: new MemorySidBlocklist(),
          }),
        }),
      ],
      controllers: [WebPushController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: WebPushWorker, useValue: worker },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('notifications');
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('mọi endpoint cần đăng nhập; cấu hình chỉ trả khóa công khai', async () => {
    await request(app.getHttpServer()).get('/notifications/web-push').expect(401);
    await request(app.getHttpServer()).post('/notifications/web-push').send(body).expect(401);
    await request(app.getHttpServer()).delete('/notifications/web-push').send({ endpoint }).expect(401);
    const reply = await request(app.getHttpServer())
      .get('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .expect(200);
    expect(reply.body).toEqual({ enabled: true, publicKey: 'public-test' });
    expect(reply.headers['cache-control']).toBe('no-store');
  });
  it('đăng ký theo người dùng từ JWT, không nhận userId do client tự gửi', async () => {
    await request(app.getHttpServer())
      .post('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .send({ ...body, userId: 'other' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .send({ ...body, endpoint: 'https://localhost/' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .send(body)
      .expect(201);
    expect(worker.register).toHaveBeenCalledWith(user, body);
  });
  it('DELETE giới hạn chủ sở hữu; tắt cấu hình từ chối đăng ký mới', async () => {
    await request(app.getHttpServer())
      .delete('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .send({ endpoint })
      .expect(204);
    expect(worker.remove).toHaveBeenCalledWith(user.userId, endpoint);
    env.WEB_PUSH_ENABLED = false;
    await request(app.getHttpServer())
      .post('/notifications/web-push')
      .set('Authorization', 'Bearer test-session')
      .send(body)
      .expect(503);
    env.WEB_PUSH_ENABLED = true;
  });
});
