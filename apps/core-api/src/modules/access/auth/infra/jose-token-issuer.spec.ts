import { createAccessTokenVerifier } from '@tripflix/auth';
import { createLocalJWKSet } from 'jose';
import { JoseTokenIssuer } from './jose-token-issuer.js';

const config = { issuer: 'tripflix-core', audience: 'tripflix' };
const now = () => new Date();
const claims = { userId: 'u1', role: 'member', sid: 's1', emailVerified: true } as const;

describe('JoseTokenIssuer: đổi khoá ký', () => {
  it('ký bằng khoá mới, vẫn kiểm được token còn hạn của khoá cũ', async () => {
    const { issuer: oldIssuer } = await JoseTokenIssuer.create(config, now);
    const oldToken = (await oldIssuer.issue(claims)).token;

    const { issuer: newIssuer } = await JoseTokenIssuer.create({ ...config, previousKeys: oldIssuer.getJwks().keys }, now);
    const jwks = newIssuer.getJwks();
    const verify = createAccessTokenVerifier({ keys: createLocalJWKSet(jwks), ...config });

    expect(jwks.keys.map((key) => key.kid)).toEqual([expect.any(String), oldIssuer.getJwks().keys[0]!.kid]);
    await expect(verify(oldToken)).resolves.toMatchObject({ userId: 'u1' });
    await expect(verify((await newIssuer.issue(claims)).token)).resolves.toMatchObject({ userId: 'u1' });
  });

  it('bỏ khoá cũ thì token của khoá cũ bị từ chối', async () => {
    const { issuer: oldIssuer } = await JoseTokenIssuer.create(config, now);
    const { issuer: newIssuer } = await JoseTokenIssuer.create(config, now);
    const verify = createAccessTokenVerifier({ keys: createLocalJWKSet(newIssuer.getJwks()), ...config });

    await expect(verify((await oldIssuer.issue(claims)).token)).rejects.toThrow();
  });

  it('dừng khi khoá cũ trùng kid với khoá đang ký', async () => {
    const { issuer: oldIssuer } = await JoseTokenIssuer.create({ ...config, kid: 'k1' }, now);
    await expect(
      JoseTokenIssuer.create({ ...config, kid: 'k1', previousKeys: oldIssuer.getJwks().keys }, now),
    ).rejects.toThrow('trùng kid');
  });
});
