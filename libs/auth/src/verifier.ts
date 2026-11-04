import { roleSchema, type Role } from '@tripflix/contracts';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Thuật toán ký duy nhất được nhận (docs/architecture/10 §3.10). */
export const ACCESS_TOKEN_ALG = 'ES256';

/** Người dùng đọc ra từ access token đã kiểm. */
export interface AuthUser {
  userId: string;
  role: Role;
  /** Mã phiên trong access.sessions; dùng để thu hồi token trước khi hết hạn. */
  sid: string;
  /** Thời điểm hết hạn của token, tính bằng giây (claim exp). */
  exp: number;
}

export interface AccessTokenVerifierOptions {
  /** Nguồn khoá công khai: createRemoteJWKSet(url) ở service khác, createLocalJWKSet ở core-api. */
  keys: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}

export type AccessTokenVerifier = (token: string) => Promise<AuthUser>;

/** Lỗi token không hợp lệ: sai chữ ký, hết hạn, sai iss/aud, thiếu claim. */
export class InvalidAccessTokenError extends Error {
  constructor(cause?: unknown) {
    super('Access token không hợp lệ', { cause });
    this.name = 'InvalidAccessTokenError';
  }
}

export function createAccessTokenVerifier({ keys, issuer, audience }: AccessTokenVerifierOptions): AccessTokenVerifier {
  return async (token) => {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        algorithms: [ACCESS_TOKEN_ALG],
        issuer,
        audience,
        requiredClaims: ['sub', 'sid', 'role', 'iat', 'exp'],
      }));
    } catch (err) {
      throw new InvalidAccessTokenError(err);
    }
    const role = roleSchema.safeParse(payload.role);
    if (!role.success || typeof payload.sid !== 'string' || !payload.sub || typeof payload.exp !== 'number') {
      throw new InvalidAccessTokenError();
    }
    return { userId: payload.sub, role: role.data, sid: payload.sid, exp: payload.exp };
  };
}
