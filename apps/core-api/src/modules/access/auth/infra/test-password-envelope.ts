import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import {
  AES_GCM_IV_BYTES,
  PASSWORD_ENVELOPE_HKDF_INFO,
  PASSWORD_ENVELOPE_PREFIX,
  PASSWORD_ENVELOPE_VERSION,
  buildPasswordAad,
  type PasswordPurpose,
} from '../domain/password-envelope.js';

export interface TestEnvelopeOptions {
  purpose: PasswordPurpose;
  /** Email đã chuẩn hoá (hoặc '' với đổi, đặt lại mật khẩu). */
  subject?: string;
  ts?: number;
  nonce?: string;
  /** Ghi đè bản rõ để thử dữ liệu sai. */
  plaintext?: string;
}

/**
 * Mã hoá mật khẩu đúng như client (web, admin, mobile làm bằng @noble), dùng node:crypto. Chỉ cho test.
 * publicKey: base64url 32 byte, lấy từ GET /auth/password-key hoặc keyring.publicKey().
 */
export function encryptPasswordForTest(
  key: { keyId: string; publicKey: string },
  password: string,
  {
    purpose,
    subject = '',
    ts = Math.floor(Date.now() / 1000),
    nonce = randomBytes(16).toString('base64url'),
    plaintext,
  }: TestEnvelopeOptions,
): string {
  const serverPublicRaw = Buffer.from(key.publicKey, 'base64url');
  const serverPublic = createPublicKey({
    key: { kty: 'OKP', crv: 'X25519', x: key.publicKey },
    format: 'jwk',
  });
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralRaw = Buffer.from(String(ephemeral.publicKey.export({ format: 'jwk' }).x), 'base64url');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: serverPublic });
  const aesKey = Buffer.from(
    hkdfSync(
      'sha256',
      shared,
      Buffer.concat([ephemeralRaw, serverPublicRaw]),
      PASSWORD_ENVELOPE_HKDF_INFO,
      32,
    ),
  );
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(buildPasswordAad(purpose, key.keyId, ts, subject));
  const body = plaintext ?? JSON.stringify({ p: password, n: nonce, t: ts });
  const sealed = Buffer.concat([cipher.update(body, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const blob = Buffer.concat([ephemeralRaw, iv, sealed]).toString('base64url');
  return `${PASSWORD_ENVELOPE_PREFIX}:${PASSWORD_ENVELOPE_VERSION}:${key.keyId}:${ts}:${blob}`;
}
