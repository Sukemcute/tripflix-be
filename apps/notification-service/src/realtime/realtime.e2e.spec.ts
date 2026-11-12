import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { generateKeyPair } from 'jose';
import type { Socket as ClientSocket } from 'socket.io-client';
import { AppModule, ENV, RealtimeService, SID_BLOCKLIST_PROVIDER } from '../app.module.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { AUTH_EXPIRED_EVENT, WS_ERROR } from './realtime.constants.js';
import {
  expectNoEvent,
  openSocket,
  signAccessToken,
  startJwks,
  testEnv,
  waitConnected,
  waitEvent,
  waitRejected,
} from './realtime.test-helpers.js';

// /ws chạy một instance, adapter trong bộ nhớ (không cần Redis). Phát qua nhiều replica: realtime.int.spec.ts.
describe('WebSocket /ws (TF26A)', () => {
  let app: INestApplication;
  let jwks: Awaited<ReturnType<typeof startJwks>>;
  let baseUrl: string;
  let realtime: RealtimeService;
  const blocklist = new MemorySidBlocklist();
  const sockets: ClientSocket[] = [];

  const open = (...args: Parameters<typeof openSocket> extends [string, ...infer R] ? R : never) => {
    const s = openSocket(baseUrl, ...args);
    sockets.push(s);
    return s;
  };
  const connectAs = async (claims: Parameters<typeof signAccessToken>[1] = {}) => {
    const s = open({ token: await signAccessToken(jwks.privateKey, claims) });
    await waitConnected(s);
    return s;
  };

  beforeAll(async () => {
    jwks = await startJwks();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(testEnv(jwks.url))
      .overrideProvider(SID_BLOCKLIST_PROVIDER)
      .useValue(blocklist)
      .overrideProvider(InboxRepository)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    realtime = app.get(RealtimeService);
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
    await jwks.close();
  });

  it('kết nối được bằng access token hợp lệ và nhận tin gửi cho mình', async () => {
    const s = await connectAs({ sub: 'u-1' });
    const got = waitEvent(s, 'notification.created');
    expect(realtime.emitToUser('u-1', 'notification.created', { id: 'n-1' })).toBe(true);
    await expect(got).resolves.toEqual({ id: 'n-1' });
  });

  it('nhận token dạng "Bearer <token>"', async () => {
    const s = open({ token: `Bearer ${await signAccessToken(jwks.privateKey)}` });
    await expect(waitConnected(s)).resolves.toBeUndefined();
  });

  it('từ chối khi thiếu token', async () => {
    const err = await waitRejected(open());
    expect(err.data?.code).toBe(WS_ERROR.unauthorized);
  });

  it('từ chối token ký bằng khoá khác', async () => {
    const forged = await generateKeyPair('ES256', { extractable: true });
    const err = await waitRejected(open({ token: await signAccessToken(forged.privateKey) }));
    expect(err.data?.code).toBe(WS_ERROR.unauthorized);
  });

  it('từ chối token đã hết hạn', async () => {
    const token = await signAccessToken(jwks.privateKey, { exp: Math.floor(Date.now() / 1000) - 5 });
    const err = await waitRejected(open({ token }));
    expect(err.data?.code).toBe(WS_ERROR.unauthorized);
  });

  it('từ chối phiên đã bị thu hồi (sid trong blocklist)', async () => {
    await blocklist.block('s-revoked', 900);
    const err = await waitRejected(
      open({ token: await signAccessToken(jwks.privateKey, { sid: 's-revoked' }) }),
    );
    expect(err.data?.code).toBe(WS_ERROR.unauthorized);
  });

  it('không nhận long-polling, chỉ websocket', async () => {
    const s = open({ token: await signAccessToken(jwks.privateKey) }, ['polling']);
    await expect(waitRejected(s)).resolves.toBeInstanceOf(Error);
  });

  it('chỉ đúng người nhận được tin của mình', async () => {
    const lan = await connectAs({ sub: 'u-lan', sid: 's-lan' });
    const minh = await connectAs({ sub: 'u-minh', sid: 's-minh' });
    const got = waitEvent(minh, 'notification.created');
    realtime.emitToUser('u-minh', 'notification.created', { id: 'n-2' });
    await expect(got).resolves.toEqual({ id: 'n-2' });
    await expectNoEvent(lan, 'notification.created');
  });

  it('mọi thiết bị của cùng người dùng đều nhận', async () => {
    const phone = await connectAs({ sub: 'u-2', sid: 's-phone' });
    const web = await connectAs({ sub: 'u-2', sid: 's-web' });
    const both = Promise.all([waitEvent(phone, 'ping'), waitEvent(web, 'ping')]);
    realtime.emitToUser('u-2', 'ping', 1);
    await expect(both).resolves.toEqual([1, 1]);
  });

  it('client tự xin vào room người khác cũng không nhận được tin của họ', async () => {
    const attacker = await connectAs({ sub: 'u-attacker', sid: 's-attacker' });
    await connectAs({ sub: 'u-victim', sid: 's-victim' });
    attacker.emit('join', 'user:u-victim');
    attacker.emit('subscribe', { room: 'user:u-victim' });
    await new Promise((r) => setTimeout(r, 100));
    realtime.emitToUser('u-victim', 'notification.created', { secret: true });
    await expectNoEvent(attacker, 'notification.created');
  });

  it('access token hết hạn trong lúc đang mở: báo auth.expired rồi ngắt', async () => {
    const s = await connectAs({ exp: Math.floor(Date.now() / 1000) + 2 });
    const expired = waitEvent(s, AUTH_EXPIRED_EVENT, 4_000);
    const reason = waitEvent<string>(s, 'disconnect', 4_000);
    await expect(expired).resolves.toEqual({});
    await expect(reason).resolves.toBe('io server disconnect');
  });

  it('disconnectUser ngắt mọi kết nối của người đó, người khác vẫn giữ', async () => {
    const locked = await connectAs({ sub: 'u-locked', sid: 's-locked' });
    const other = await connectAs({ sub: 'u-other', sid: 's-other' });
    const reason = waitEvent<string>(locked, 'disconnect');
    realtime.disconnectUser('u-locked');
    await expect(reason).resolves.toBe('io server disconnect');
    expect(other.connected).toBe(true);
  });

  it('disconnectSession chỉ ngắt thiết bị của phiên đó', async () => {
    const phone = await connectAs({ sub: 'u-3', sid: 's-3-phone' });
    const web = await connectAs({ sub: 'u-3', sid: 's-3-web' });
    const reason = waitEvent<string>(phone, 'disconnect');
    realtime.disconnectSession('s-3-phone');
    await expect(reason).resolves.toBe('io server disconnect');
    expect(web.connected).toBe(true);
  });
});
