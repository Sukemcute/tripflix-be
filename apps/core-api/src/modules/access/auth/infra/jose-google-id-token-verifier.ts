import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { GoogleIdentity, GoogleIdTokenVerifier } from '../application/ports.js';
import { GOOGLE_LOGIN_FAILED_MESSAGE, GOOGLE_NOT_CONFIGURED_MESSAGE } from '../domain/credentials.js';
import { AccessError } from '../domain/errors.js';

/** Google ký ID token bằng RS256, iss là một trong hai giá trị này (developers.google.com/identity). */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Kiểm Google ID token mà app, web lấy từ Google Sign-In: chữ ký qua JWKS của Google, iss, aud là một trong
 * GOOGLE_CLIENT_IDS (của Tripflix), exp, email_verified. Không gọi API Google nào khác.
 */
export class JoseGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  constructor(
    private readonly keys: JWTVerifyGetKey,
    private readonly clientIds: string[],
  ) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (this.clientIds.length === 0) throw new AccessError('google_not_configured', GOOGLE_NOT_CONFIGURED_MESSAGE);
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        algorithms: ['RS256'],
        issuer: GOOGLE_ISSUERS,
        audience: this.clientIds,
        requiredClaims: ['sub', 'email', 'iat', 'exp'],
      }));
    } catch {
      throw new AccessError('google_invalid', GOOGLE_LOGIN_FAILED_MESSAGE);
    }
    // email_verified=false: ai đó có thể gắn email của người khác vào tài khoản Google, không được liên kết theo email.
    const isEmailVerified = payload.email_verified === true || payload.email_verified === 'true';
    if (!isEmailVerified || typeof payload.email !== 'string' || !payload.sub) {
      throw new AccessError('google_invalid', GOOGLE_LOGIN_FAILED_MESSAGE);
    }
    return {
      subject: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null,
    };
  }
}
