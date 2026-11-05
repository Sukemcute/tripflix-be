import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { AccessError } from '../domain/errors.js';
import { JoseGoogleIdTokenVerifier } from './jose-google-id-token-verifier.js';

describe('JoseGoogleIdTokenVerifier', () => {
  let key: CryptoKey;
  let keys: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    const pub = await exportJWK(pair.publicKey);
    keys = createLocalJWKSet({ keys: [{ ...pub, kid: 'k1', alg: 'RS256' }] });
  });

  const sign = (claims: Record<string, unknown>, iss = 'accounts.google.com') =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(iss)
      .setAudience('web-client')
      .setSubject('sub-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

  it('nhận iss "accounts.google.com", email_verified dạng chuỗi "true"; tên trống thì null', async () => {
    const verifier = new JoseGoogleIdTokenVerifier(keys, ['web-client']);
    await expect(verifier.verify(await sign({ email: 'a@gmail.com', email_verified: 'true', name: '  ' }))).resolves.toEqual({
      subject: 'sub-1',
      email: 'a@gmail.com',
      name: null,
    });
  });

  it('thiếu email: google_invalid', async () => {
    const verifier = new JoseGoogleIdTokenVerifier(keys, ['web-client']);
    await expect(verifier.verify(await sign({ email_verified: true }))).rejects.toMatchObject({ code: 'google_invalid' });
  });

  it('chưa cấu hình GOOGLE_CLIENT_IDS: google_not_configured, không kiểm token', async () => {
    const verifier = new JoseGoogleIdTokenVerifier(keys, []);
    const err = await verifier.verify(await sign({ email: 'a@gmail.com', email_verified: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessError);
    expect(err).toMatchObject({ code: 'google_not_configured' });
  });
});
