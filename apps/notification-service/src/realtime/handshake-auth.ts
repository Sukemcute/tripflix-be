import {
  InvalidAccessTokenError,
  UNAUTHORIZED_MESSAGE,
  type AccessTokenVerifier,
  type AuthUser,
  type SidBlocklist,
} from '@tripflix/auth';
import type { Socket } from 'socket.io';
import { WS_ERROR } from './realtime.constants.js';

/** Dữ liệu server gắn vào socket sau khi bắt tay thành công. */
export interface RealtimeSocketData {
  user: AuthUser;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

export type RealtimeSocket = Socket<
  Record<string, never>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, never>,
  RealtimeSocketData
>;

/** Lỗi trả về client qua connect_error; Socket.IO gửi kèm err.data. */
export class HandshakeError extends Error {
  readonly data: { code: string };

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HandshakeError';
    this.data = { code };
  }
}

/** Token lấy từ io(url, { auth: { token } }). Chấp nhận cả dạng "Bearer <token>". */
export function readHandshakeToken(auth: unknown): string | undefined {
  if (!auth || typeof auth !== 'object') return undefined;
  const raw = (auth as Record<string, unknown>).token;
  if (typeof raw !== 'string') return undefined;
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  return token || undefined;
}

export interface HandshakeAuthDeps {
  verify: AccessTokenVerifier;
  blocklist: SidBlocklist;
  /** Ghi log lỗi không phải do client (Redis lỗi khi kiểm sid). */
  onError?: (err: unknown) => void;
}

/**
 * Middleware bắt tay Socket.IO: kiểm chữ ký, iss, aud, exp qua JWKS và sid chưa bị thu hồi, giống AccessTokenGuard của HTTP.
 * Redis lỗi thì từ chối (không cho qua khi chưa kiểm được phiên); client thử lại sau.
 */
export function createHandshakeAuth({ verify, blocklist, onError }: HandshakeAuthDeps) {
  return async (
    socket: Pick<RealtimeSocket, 'handshake' | 'data'>,
    next: (err?: Error) => void,
  ): Promise<void> => {
    const token = readHandshakeToken(socket.handshake.auth);
    if (!token) return next(new HandshakeError(WS_ERROR.unauthorized, UNAUTHORIZED_MESSAGE));
    let user: AuthUser;
    try {
      user = await verify(token);
    } catch (err) {
      if (err instanceof InvalidAccessTokenError)
        return next(new HandshakeError(WS_ERROR.unauthorized, UNAUTHORIZED_MESSAGE));
      onError?.(err);
      return next(new HandshakeError(WS_ERROR.unavailable, 'Chưa kiểm được phiên đăng nhập, thử lại sau'));
    }
    let revoked: boolean;
    try {
      revoked = await blocklist.isBlocked(user.sid);
    } catch (err) {
      onError?.(err);
      return next(new HandshakeError(WS_ERROR.unavailable, 'Chưa kiểm được phiên đăng nhập, thử lại sau'));
    }
    if (revoked) return next(new HandshakeError(WS_ERROR.unauthorized, UNAUTHORIZED_MESSAGE));
    socket.data.user = user;
    next();
  };
}
