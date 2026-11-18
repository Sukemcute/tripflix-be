import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCors, applyGlobalPrefix, applySecurityHeaders, SECURITY_HEADERS } from './http.js';

@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }

  @Get('missing')
  missing() {
    throw new NotFoundException('không có');
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const WEB_ORIGIN = 'https://tripflix.io.vn';

describe('E2E: header bảo mật (TF33)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Cùng thứ tự với setupHttp.
    applySecurityHeaders(app);
    applyGlobalPrefix(app);
    applyCors(app, [WEB_ORIGIN]);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectSecurityHeaders = (headers: Record<string, string | string[] | undefined>) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers[name.toLowerCase()], name).toBe(value);
    }
  };

  it('phản hồi thành công có đủ header bảo mật', async () => {
    const res = await http().get('/api/probe').expect(200);
    expectSecurityHeaders(res.headers);
  });

  it('phản hồi lỗi và đường dẫn không có route vẫn có header', async () => {
    expectSecurityHeaders((await http().get('/api/probe/missing').expect(404)).headers);
    expectSecurityHeaders((await http().get('/api/khong-co-route').expect(404)).headers);
  });

  it('preflight CORS của web vẫn chạy và cũng có header', async () => {
    const res = await http()
      .options('/api/probe')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expectSecurityHeaders(res.headers);
  });

  it('không gửi X-XSS-Protection (đã bỏ ở trình duyệt) và HSTS không có preload', async () => {
    const res = await http().get('/api/probe').expect(200);
    expect(res.headers['x-xss-protection']).toBeUndefined();
    expect(res.headers['strict-transport-security']).not.toContain('preload');
  });
});
