import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
} from 'node:crypto';
import type { PasswordKeyring, PublicPasswordKey } from '../application/ports.js';
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  PASSWORD_ENVELOPE_ALGORITHM,
  PASSWORD_ENVELOPE_HKDF_INFO,
  PasswordEnvelopeError,
  X25519_KEY_BYTES,
  isValidPasswordKeyId,
  type ParsedPasswordEnvelope,
} from '../domain/password-envelope.js';

/** Tiền tố DER PKCS#8 của khoá riêng X25519; ghép với 32 byte khoá thô. */
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

interface KeyEntry {
  keyId: string;
  privateKey: KeyObject;
  publicKeyRaw: Buffer;
}

function rawPublicKey(privateKey: KeyObject): Buffer {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  return Buffer.from(String(jwk.x), 'base64url');
}

function entryFromRaw(keyId: string, raw: Buffer): KeyEntry {
  if (raw.length !== X25519_KEY_BYTES) throw new Error(`Khoá ${keyId} phải dài ${X25519_KEY_BYTES} byte`);
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
  return { keyId, privateKey, publicKeyRaw: rawPublicKey(privateKey) };
}

/** Sinh khoá mới, trả 32 byte thô dạng base64url (dùng cho CLI và khoá tạm khi dev). */
export function generatePasswordKey(): string {
  const { privateKey } = generateKeyPairSync('x25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  return der.subarray(der.length - X25519_KEY_BYTES).toString('base64url');
}

/**
 * Đọc AUTH_PASSWORD_KEYS: "<keyId>:<khoá base64url>,<keyId cũ>:<khoá cũ>". Khoá đầu tiên là khoá đang dùng,
 * các khoá sau chỉ để giải mã chuỗi client mã hoá trước lúc đổi khoá.
 */
export function parsePasswordKeys(value: string): { keyId: string; raw: Buffer }[] {
  const entries = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const sep = item.indexOf(':');
      const keyId = sep > 0 ? item.slice(0, sep) : '';
      const key = sep > 0 ? item.slice(sep + 1) : '';
      if (!isValidPasswordKeyId(keyId) || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
        throw new Error(
          'AUTH_PASSWORD_KEYS sai dạng: cần "<keyId>:<khoá base64url 32 byte>", cách nhau bởi dấu phẩy',
        );
      }
      return { keyId, raw: Buffer.from(key, 'base64url') };
    });
  if (entries.length === 0) throw new Error('AUTH_PASSWORD_KEYS không có khoá nào');
  if (new Set(entries.map((e) => e.keyId)).size !== entries.length)
    throw new Error('AUTH_PASSWORD_KEYS có keyId trùng');
  return entries;
}

/** Giải mã chuỗi mật khẩu của client bằng node:crypto. Client (web, admin, mobile) mã hoá bằng @noble. */
export class X25519PasswordKeyring implements PasswordKeyring {
  private readonly keys: Map<string, KeyEntry>;
  private readonly active: KeyEntry;

  private constructor(entries: KeyEntry[]) {
    this.keys = new Map(entries.map((e) => [e.keyId, e]));
    this.active = entries[0]!;
  }

  static fromConfig(value: string): X25519PasswordKeyring {
    return new X25519PasswordKeyring(parsePasswordKeys(value).map((e) => entryFromRaw(e.keyId, e.raw)));
  }

  /** Khoá tạm cho dev, test: đổi mỗi lần khởi động; client chỉ cần lấy lại khoá công khai. */
  static ephemeral(keyId = 'dev'): X25519PasswordKeyring {
    return new X25519PasswordKeyring([entryFromRaw(keyId, Buffer.from(generatePasswordKey(), 'base64url'))]);
  }

  publicKey(): PublicPasswordKey {
    return {
      keyId: this.active.keyId,
      publicKey: this.active.publicKeyRaw.toString('base64url'),
      algorithm: PASSWORD_ENVELOPE_ALGORITHM,
    };
  }

  decrypt(envelope: ParsedPasswordEnvelope, aad: Buffer): string {
    const entry = this.keys.get(envelope.keyId);
    if (!entry) throw new PasswordEnvelopeError('unknown_key');
    const { blob } = envelope;
    const ephemeralRaw = blob.subarray(0, X25519_KEY_BYTES);
    const iv = blob.subarray(X25519_KEY_BYTES, X25519_KEY_BYTES + AES_GCM_IV_BYTES);
    const sealed = blob.subarray(X25519_KEY_BYTES + AES_GCM_IV_BYTES);
    const ciphertext = sealed.subarray(0, sealed.length - AES_GCM_TAG_BYTES);
    const tag = sealed.subarray(sealed.length - AES_GCM_TAG_BYTES);
    try {
      const ephemeral = createPublicKey({
        key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(ephemeralRaw).toString('base64url') },
        format: 'jwk',
      });
      const shared = diffieHellman({ privateKey: entry.privateKey, publicKey: ephemeral });
      // Khoá công khai cấp thấp (low-order point) cho ra bí mật toàn số 0: từ chối.
      if (shared.every((b) => b === 0)) throw new PasswordEnvelopeError('decrypt_failed');
      const key = Buffer.from(
        hkdfSync(
          'sha256',
          shared,
          Buffer.concat([ephemeralRaw, entry.publicKeyRaw]),
          PASSWORD_ENVELOPE_HKDF_INFO,
          32,
        ),
      );
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AES_GCM_TAG_BYTES });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (err) {
      if (err instanceof PasswordEnvelopeError) throw err;
      throw new PasswordEnvelopeError('decrypt_failed');
    }
  }
}
