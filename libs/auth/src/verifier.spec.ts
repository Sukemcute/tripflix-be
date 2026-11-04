import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import { InvalidAccessTokenError, createAccessTokenVerifier } from './verifier.js';

const ISSUER = 'tripflix-core';
const AUDIENCE = 'tripflix';

async function keyPair(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey, jwk };
}

function sign(
  key: CryptoKey,
  { kid = 'k1', alg = 'ES256', claims = {}, iss = ISSUER, aud = AUDIENCE, exp = '15m' } = {} as {
    kid?: string;
    alg?: string;
    claims?: Record<string, unknown>;
    iss?: string;
    aud?: string;
    exp?: string | number;
  },
) {
  return new SignJWT({ role: 'member', sid: 's-1', ...claims })
    .setProtectedHeader({ alg, kid })
    .setSubject('u-1')
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

describe('createAccessTokenVerifier', () => {
  let good: Awaited<ReturnType<typeof keyPair>>;
  let verify: ReturnType<typeof createAccessTokenVerifier>;

  beforeAll(async () => {
    good = await keyPair('k1');
    verify = createAccessTokenVerifier({
      keys: createLocalJWKSet({ keys: [good.jwk] }),
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  });

  it('nhận token đúng và trả sub, role, sid', async () => {
    const user = await verify(await sign(good.privateKey));
    expect(user).toMatchObject({ userId: 'u-1', role: 'member', sid: 's-1' });
    expect(user.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('từ chối token ký bằng khoá khác dù cùng kid', async () => {
    const other = await keyPair('k1');
    await expect(verify(await sign(other.privateKey))).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('từ chối token hết hạn', async () => {
    const token = await sign(good.privateKey, { exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('từ chối sai iss', async () => {
    await expect(verify(await sign(good.privateKey, { iss: 'hacker' }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('từ chối sai aud', async () => {
    await expect(verify(await sign(good.privateKey, { aud: 'admin' }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('từ chối thuật toán khác ES256', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'rs', alg: 'RS256' };
    const verifyRs = createAccessTokenVerifier({
      keys: createLocalJWKSet({ keys: [good.jwk, jwk] }),
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    await expect(verifyRs(await sign(privateKey, { kid: 'rs', alg: 'RS256' }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('từ chối token thiếu sid hoặc role lạ', async () => {
    await expect(verify(await sign(good.privateKey, { claims: { sid: undefined } }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
    await expect(verify(await sign(good.privateKey, { claims: { role: 'god' } }))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });
});
