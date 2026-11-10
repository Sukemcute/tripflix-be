import { InvalidAccessTokenError, MemorySidBlocklist, type AuthUser } from '@tripflix/auth';
import {
  createHandshakeAuth,
  HandshakeError,
  readHandshakeToken,
  type RealtimeSocketData,
} from './handshake-auth.js';
import { WS_ERROR } from './realtime.constants.js';

const USER: AuthUser = {
  userId: 'u-1',
  role: 'member',
  sid: 's-1',
  exp: Math.floor(Date.now() / 1000) + 900,
  emailVerified: true,
};

function fakeSocket(auth: unknown) {
  return { handshake: { auth } as never, data: {} as RealtimeSocketData };
}

async function run(middleware: ReturnType<typeof createHandshakeAuth>, auth: unknown) {
  const socket = fakeSocket(auth);
  let error: Error | undefined;
  await middleware(socket, (err?: Error) => {
    error = err;
  });
  return { socket, error: error as HandshakeError | undefined };
}

describe('readHandshakeToken', () => {
  it('đọc token từ auth.token, bỏ tiền tố Bearer', () => {
    expect(readHandshakeToken({ token: 'abc' })).toBe('abc');
    expect(readHandshakeToken({ token: 'Bearer abc' })).toBe('abc');
  });

  it('trả undefined khi thiếu hoặc sai kiểu', () => {
    expect(readHandshakeToken(undefined)).toBeUndefined();
    expect(readHandshakeToken({})).toBeUndefined();
    expect(readHandshakeToken({ token: 42 })).toBeUndefined();
    expect(readHandshakeToken({ token: '   ' })).toBeUndefined();
  });
});

describe('createHandshakeAuth', () => {
  it('token hợp lệ, sid chưa thu hồi: cho qua và gắn user vào socket', async () => {
    const verify = vi.fn().mockResolvedValue(USER);
    const { socket, error } = await run(
      createHandshakeAuth({ verify, blocklist: new MemorySidBlocklist() }),
      { token: 't' },
    );
    expect(error).toBeUndefined();
    expect(socket.data.user).toEqual(USER);
    expect(verify).toHaveBeenCalledWith('t');
  });

  it('thiếu token: unauthorized, không gọi verifier', async () => {
    const verify = vi.fn();
    const { socket, error } = await run(
      createHandshakeAuth({ verify, blocklist: new MemorySidBlocklist() }),
      {},
    );
    expect(error?.data.code).toBe(WS_ERROR.unauthorized);
    expect(verify).not.toHaveBeenCalled();
    expect(socket.data.user).toBeUndefined();
  });

  it('token sai chữ ký hoặc hết hạn: unauthorized', async () => {
    const verify = vi.fn().mockRejectedValue(new InvalidAccessTokenError());
    const { error } = await run(createHandshakeAuth({ verify, blocklist: new MemorySidBlocklist() }), {
      token: 't',
    });
    expect(error?.data.code).toBe(WS_ERROR.unauthorized);
  });

  it('sid đã bị thu hồi: unauthorized', async () => {
    const blocklist = new MemorySidBlocklist();
    await blocklist.block('s-1', 900);
    const { socket, error } = await run(
      createHandshakeAuth({ verify: vi.fn().mockResolvedValue(USER), blocklist }),
      { token: 't' },
    );
    expect(error?.data.code).toBe(WS_ERROR.unauthorized);
    expect(socket.data.user).toBeUndefined();
  });

  it('Redis lỗi khi kiểm sid: từ chối với mã unavailable và ghi log, không cho qua', async () => {
    const onError = vi.fn();
    const blocklist = { block: vi.fn(), isBlocked: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const { socket, error } = await run(
      createHandshakeAuth({ verify: vi.fn().mockResolvedValue(USER), blocklist, onError }),
      { token: 't' },
    );
    expect(error?.data.code).toBe(WS_ERROR.unavailable);
    expect(onError).toHaveBeenCalled();
    expect(socket.data.user).toBeUndefined();
  });

  it('JWKS lỗi mạng (không phải token sai): unavailable', async () => {
    const onError = vi.fn();
    const verify = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const { error } = await run(
      createHandshakeAuth({ verify, blocklist: new MemorySidBlocklist(), onError }),
      { token: 't' },
    );
    expect(error?.data.code).toBe(WS_ERROR.unavailable);
    expect(onError).toHaveBeenCalled();
  });
});
