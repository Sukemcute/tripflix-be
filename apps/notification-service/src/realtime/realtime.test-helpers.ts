import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { Env } from '../env.js';
import { WS_PATH } from './realtime.constants.js';

/** Khoá và máy chủ JWKS giả lập core-api, dùng chung cho test e2e và int của /ws. */
export async function startJwks() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const server: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    privateKey,
    url: `http://127.0.0.1:${port}/.well-known/jwks.json`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export function signAccessToken(
  key: CryptoKey,
  { sub = 'u-1', sid = 's-1', exp = '15m' as string | number, role = 'member' } = {},
) {
  return new SignJWT({ role, sid })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(sub)
    .setIssuer('tripflix-core')
    .setAudience('tripflix')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

export function testEnv(jwksUrl: string, redisUrl = 'redis://127.0.0.1:6379'): Env {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    PORT: 0,
    REDIS_URL: redisUrl,
    DATABASE_URL_NOTIFICATION: 'postgres://unused@127.0.0.1:5432/unused',
    JWKS_URL: jwksUrl,
    AUTH_JWT_ISSUER: 'tripflix-core',
    AUTH_JWT_AUDIENCE: 'tripflix',
    SMTP_URL: 'smtp://127.0.0.1:1025',
    MAIL_FROM: 'Tripflix <no-reply@tripflix.local>',
    WEB_APP_URL: 'http://localhost:3100',
    WEB_ORIGINS: ['http://localhost:3100'],
    // Test /ws không cần consumer.
    NOTIFICATION_CONSUMER_ENABLED: false,
    NOTIFICATION_CONSUMER_NAME: undefined,
    NOTIFICATION_DLQ_REPLAY_INTERVAL_MS: 60_000,
  };
}

/** Client Socket.IO như web và app sẽ dùng: chỉ websocket, token trong auth. */
export function openSocket(
  baseUrl: string,
  auth?: Record<string, unknown>,
  transports: ('websocket' | 'polling')[] = ['websocket'],
): ClientSocket {
  return io(baseUrl, {
    path: WS_PATH,
    transports,
    auth,
    reconnection: false,
    forceNew: true,
    timeout: 3_000,
  });
}

export const waitConnected = (s: ClientSocket) =>
  new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });

export const waitRejected = (s: ClientSocket) =>
  new Promise<Error & { data?: { code?: string } }>((resolve, reject) => {
    s.once('connect_error', resolve);
    s.once('connect', () => reject(new Error('Kết nối được trong khi lẽ ra bị từ chối')));
  });

export const waitEvent = <T = unknown>(s: ClientSocket, event: string, ms = 3_000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Không nhận được ${event} sau ${ms} ms`)), ms);
    s.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

export const expectNoEvent = (s: ClientSocket, event: string, ms = 300) =>
  new Promise<void>((resolve, reject) => {
    const handler = () => reject(new Error(`Nhận ${event} trong khi không được nhận`));
    s.once(event, handler);
    setTimeout(() => {
      s.off(event, handler);
      resolve();
    }, ms);
  });
