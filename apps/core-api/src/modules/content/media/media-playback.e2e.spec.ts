import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyGlobalPrefix } from '../../../platform/http.js';
import { MediaPlaybackController } from './api/media-playback.controller.js';
import { MediaPlaybackUseCases } from './application/media-playback.use-cases.js';
import {
  MEDIA_CLOCK,
  PLAYBACK_COOKIE_SIGNER,
  PLAYBACK_SETTINGS,
  type PlaybackCookieSigner,
  type PlaybackSettings,
} from './application/ports.js';

const NOW = new Date('2026-11-17T06:00:00.000Z');
const SIGNED = { 'CloudFront-Policy': 'cG9s', 'CloudFront-Signature': 'c2ln~_-', 'CloudFront-Key-Pair-Id': 'K2TEST' };
const fakeSigner: PlaybackCookieSigner = { signCookies: () => SIGNED };

async function createApp(settings: PlaybackSettings, signer: PlaybackCookieSigner | null): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [MediaPlaybackController],
    providers: [
      MediaPlaybackUseCases,
      { provide: PLAYBACK_SETTINGS, useValue: settings },
      { provide: PLAYBACK_COOKIE_SIGNER, useValue: signer },
      { provide: MEDIA_CLOCK, useValue: () => NOW },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  applyGlobalPrefix(app);
  await app.init();
  return app;
}

describe('POST /api/media/playback-session', () => {
  let app: INestApplication;
  afterEach(() => app.close());

  it('khách chưa đăng nhập vẫn nhận cookie; web nhận Set-Cookie HttpOnly cho tên miền media', async () => {
    app = await createApp({ cdnBaseUrl: 'https://media.test', ttlSec: 3600, cookieDomain: '.test' }, fakeSigner);

    const response = await request(app.getHttpServer())
      .post('/api/media/playback-session')
      .set('Origin', 'https://web.test')
      .expect(200);

    expect(response.body).toEqual({ cookies: SIGNED, expiresAt: '2026-11-17T07:00:00.000Z' });
    expect(response.headers['cache-control']).toBe('no-store');
    const setCookies = response.headers['set-cookie'] as unknown as string[];
    expect(setCookies).toHaveLength(3);
    // Giữ nguyên ký tự ~ _ - của CloudFront, không mã hoá thêm.
    expect(setCookies).toContainEqual(
      'CloudFront-Signature=c2ln~_-; Domain=.test; Path=/; Expires=Tue, 17 Nov 2026 07:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('app (không gửi Origin) chỉ nhận cookie trong body, không có Set-Cookie để kho cookie của máy không giữ bản lệch', async () => {
    app = await createApp({ cdnBaseUrl: 'https://media.test', ttlSec: 3600, cookieDomain: '.test' }, fakeSigner);

    const response = await request(app.getHttpServer()).post('/api/media/playback-session').expect(200);

    expect(response.body.cookies).toEqual(SIGNED);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('không có MEDIA_COOKIE_DOMAIN thì chỉ trả cookie trong body, kể cả với trình duyệt', async () => {
    app = await createApp({ cdnBaseUrl: 'https://media.test', ttlSec: 3600, cookieDomain: undefined }, fakeSigner);

    const response = await request(app.getHttpServer())
      .post('/api/media/playback-session')
      .set('Origin', 'https://web.test')
      .expect(200);

    expect(response.body.cookies).toEqual(SIGNED);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('server chưa có khoá ký thì trả cookie rỗng, không đặt cookie', async () => {
    app = await createApp({ cdnBaseUrl: 'https://media.test', ttlSec: 3600, cookieDomain: '.test' }, null);

    const response = await request(app.getHttpServer())
      .post('/api/media/playback-session')
      .set('Origin', 'https://web.test')
      .expect(200);

    expect(response.body).toEqual({ cookies: {}, expiresAt: null });
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
