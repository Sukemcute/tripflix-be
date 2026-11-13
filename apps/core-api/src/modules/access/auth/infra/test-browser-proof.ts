import { randomUUID, webcrypto } from 'node:crypto';
import { BROWSER_PROOF_HEADER, type BrowserProofPurpose } from '../application/browser-session-proof.js';

export async function createTestBrowserProof() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'],
  );
  const { kty, crv, x, y } = await webcrypto.subtle.exportKey('jwk', publicKey);
  return async (purpose: BrowserProofPurpose, origin: string) => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'tripflix-session+jwt', jwk: { kty, crv, x, y } }))
      .toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      aud: `tripflix-session:${origin}`, sub: purpose, iat: Math.floor(Date.now() / 1000), jti: randomUUID(),
    })).toString('base64url');
    const message = `${header}.${payload}`;
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(message));
    return { [BROWSER_PROOF_HEADER]: `${message}.${Buffer.from(signature).toString('base64url')}` };
  };
}
