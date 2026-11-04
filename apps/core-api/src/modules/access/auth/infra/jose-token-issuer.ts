import { ACCESS_TOKEN_ALG } from '@tripflix/auth';
import type { Role } from '@tripflix/contracts';
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  type CryptoKey,
  type JWK,
} from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '../domain/refresh-rotation.js';
import type { Clock, IssuedAccessToken, TokenIssuer } from '../application/ports.js';

export interface TokenIssuerConfig {
  /** PEM PKCS8 của khoá ES256. Bỏ trống ở dev, test thì tự sinh khoá tạm. */
  privateKeyPem?: string | undefined;
  kid?: string | undefined;
  issuer: string;
  audience: string;
}

/** Ký access token ES256. Khoá riêng chỉ nằm ở core-api; service khác lấy khoá công khai qua JWKS. */
export class JoseTokenIssuer implements TokenIssuer {
  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicJwk: JWK,
    private readonly config: TokenIssuerConfig,
    private readonly now: Clock,
  ) {}

  /** isEphemeral = true khi phải tự sinh khoá (chỉ cho phép ngoài production, env.ts đã kiểm). */
  static async create(config: TokenIssuerConfig, now: Clock): Promise<{ issuer: JoseTokenIssuer; isEphemeral: boolean }> {
    const pem = config.privateKeyPem?.replace(/\\n/g, '\n').trim();
    const privateKey = pem
      ? await importPKCS8(pem, ACCESS_TOKEN_ALG, { extractable: true })
      : (await generateKeyPair(ACCESS_TOKEN_ALG, { extractable: true })).privateKey;
    // Khoá công khai là khoá riêng bỏ phần bí mật d.
    const { d: _secret, ...publicPart } = await exportJWK(privateKey);
    const kid = config.kid || (await calculateJwkThumbprint(publicPart));
    const publicJwk: JWK = { ...publicPart, kid, alg: ACCESS_TOKEN_ALG, use: 'sig' };
    return { issuer: new JoseTokenIssuer(privateKey, publicJwk, config, now), isEphemeral: !pem };
  }

  async issue({ userId, role, sid }: { userId: string; role: Role; sid: string }): Promise<IssuedAccessToken> {
    const iat = Math.floor(this.now().getTime() / 1000);
    const token = await new SignJWT({ role, sid })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALG, kid: this.publicJwk.kid ?? '', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.privateKey);
    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  getJwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }
}
