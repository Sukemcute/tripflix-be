import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MemorySidBlocklist } from '@tripflix/auth';
import { startRedis, type RedisFixture } from '@tripflix/testing';
import type { Socket as ClientSocket } from 'socket.io-client';
import { AppModule, ENV, REALTIME_REDIS, RealtimeService, SID_BLOCKLIST_PROVIDER } from '../app.module.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { isRealtimeRedisReady, useRedisRealtime, type RealtimeRedis } from './redis-io.adapter.js';
import {
  openSocket,
  signAccessToken,
  startJwks,
  testEnv,
  waitConnected,
  waitEvent,
} from './realtime.test-helpers.js';

// Hai replica notification-service dùng chung Redis thật: phát ở replica A, client nối vào replica B vẫn nhận.
describe('/ws chạy nhiều replica qua Redis adapter', () => {
  let fixture: RedisFixture;
  let jwks: Awaited<ReturnType<typeof startJwks>>;
  let replicaA: INestApplication;
  let replicaB: INestApplication;
  let urlB: string;
  const sockets: ClientSocket[] = [];

  async function startReplica(redisUrl: string) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(testEnv(jwks.url, redisUrl))
      .overrideProvider(SID_BLOCKLIST_PROVIDER)
      .useValue(new MemorySidBlocklist())
      .overrideProvider(InboxRepository)
      .useValue({})
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await useRedisRealtime(app);
    await app.listen(0, '127.0.0.1');
    return app;
  }

  /** Redis pub/sub chưa đăng ký xong kênh thì tin phát đi bị mất: chờ cả hai replica sẵn sàng. */
  async function waitAdaptersReady() {
    for (let i = 0; i < 50; i++) {
      if ([replicaA, replicaB].every((app) => isRealtimeRedisReady(app.get<RealtimeRedis>(REALTIME_REDIS)))) {
        await new Promise((r) => setTimeout(r, 200));
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Redis adapter chưa sẵn sàng');
  }

  const connectToB = async (claims: Parameters<typeof signAccessToken>[1]) => {
    const s = openSocket(urlB, { token: await signAccessToken(jwks.privateKey, claims) });
    sockets.push(s);
    await waitConnected(s);
    return s;
  };

  beforeAll(async () => {
    fixture = await startRedis();
    jwks = await startJwks();
    replicaA = await startReplica(fixture.url);
    replicaB = await startReplica(fixture.url);
    const { port } = replicaB.getHttpServer().address() as AddressInfo;
    urlB = `http://127.0.0.1:${port}`;
    await waitAdaptersReady();
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await replicaA?.close();
    await replicaB?.close();
    await jwks?.close();
    await fixture?.stop();
  });

  it('kết nối Redis pub/sub của cả hai replica sẵn sàng', () => {
    expect(isRealtimeRedisReady(replicaA.get<RealtimeRedis>(REALTIME_REDIS))).toBe(true);
    expect(isRealtimeRedisReady(replicaB.get<RealtimeRedis>(REALTIME_REDIS))).toBe(true);
  });

  it('phát ở replica A, client nối vào replica B nhận được', async () => {
    const s = await connectToB({ sub: 'u-1', sid: 's-1' });
    const got = waitEvent(s, 'notification.created');
    replicaA.get(RealtimeService).emitToUser('u-1', 'notification.created', { id: 'n-1' });
    await expect(got).resolves.toEqual({ id: 'n-1' });
  });

  it('khoá tài khoản ở replica A ngắt được socket đang nằm ở replica B', async () => {
    const s = await connectToB({ sub: 'u-locked', sid: 's-locked' });
    const reason = waitEvent<string>(s, 'disconnect');
    replicaA.get(RealtimeService).disconnectUser('u-locked');
    await expect(reason).resolves.toBe('io server disconnect');
  });
});
