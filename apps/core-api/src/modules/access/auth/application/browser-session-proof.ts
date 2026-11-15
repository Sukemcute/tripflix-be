import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { z } from 'zod';

export const BROWSER_PROOF_HEADER = 'X-Tripflix-Session-Proof';
export const BROWSER_PROOF_TTL_SECONDS = 90;
export type BrowserProofPurpose = 'login' | 'google' | 'refresh';
export interface BrowserProof {
  value: string | undefined;
  origin: string | undefined;
}

const PublicKeySchema = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export async function verifyBrowserProof(proof: BrowserProof, purpose: BrowserProofPurpose, now: Date) {
  if (!proof.value || proof.value.length > 1024 || !proof.origin) return null;
  try {
    const header = decodeProtectedHeader(proof.value);
    if (header.alg !== 'ES256' || header.typ !== 'tripflix-session+jwt') return null;
    const jwk = PublicKeySchema.parse(header.jwk);
    const key = await importJWK(jwk, 'ES256');
    const { payload } = await jwtVerify(proof.value, key, {
      algorithms: ['ES256'],
      audience: `tripflix-session:${proof.origin}`,
      subject: purpose,
      currentDate: now,
      maxTokenAge: 60,
      clockTolerance: 5,
      requiredClaims: ['jti'],
    });
    if (typeof payload.jti !== 'string' || !z.uuid().safeParse(payload.jti).success) return null;
    return { thumbprint: await calculateJwkThumbprint(jwk), nonce: payload.jti };
  } catch {
    return null;
  }
}
