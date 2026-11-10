import { normalizeEmail } from './credentials.js';

/**
 * Mật khẩu mã hoá trong trình duyệt hoặc app trước khi gửi (TF056, cách làm giống Facebook "#PWD_BROWSER").
 * HTTPS vẫn là lớp bảo vệ chính; lớp này để mật khẩu gốc không nằm trong payload, log, proxy hay công cụ debug.
 *
 * Dạng chuỗi gửi lên: "#TFPWD:1:<keyId>:<ts>:<base64url(ephemeralPublicKey | iv | ciphertext+tag)>"
 * - Mã hoá: X25519 (khoá tạm của client với khoá công khai của server) → HKDF-SHA256 → AES-256-GCM.
 * - AAD gắn mục đích, keyId, ts và email: chuỗi mã hoá cho đăng nhập không dùng được cho việc khác hay email khác.
 * - Bản rõ là JSON { p: mật khẩu, n: nonce, t: ts }; nonce chỉ dùng một lần để chuỗi chép lại không gửi lại được.
 */
export const PASSWORD_ENVELOPE_PREFIX = '#TFPWD';
export const PASSWORD_ENVELOPE_VERSION = 1;
export const PASSWORD_ENVELOPE_ALGORITHM = 'X25519-HKDF-SHA256-A256GCM';
/** info của HKDF; client dùng đúng chuỗi này. */
export const PASSWORD_ENVELOPE_HKDF_INFO = 'tripflix-pwd-v1';

/** Chuỗi mã hoá dùng được trong 5 phút; chấp nhận đồng hồ client nhanh hơn server tối đa 60 giây. */
export const PASSWORD_ENVELOPE_MAX_AGE_SECONDS = 300;
export const PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS = 60;
/** Giữ nonce đã dùng lâu hơn thời hạn của chuỗi, để không chuỗi nào còn hạn mà dùng lại được. */
export const PASSWORD_NONCE_TTL_SECONDS = 600;

export const X25519_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
/** Chuỗi dài hơn mức này chắc chắn không phải mật khẩu thật (mật khẩu tối đa 1024 ký tự). */
export const PASSWORD_ENVELOPE_MAX_LENGTH = 6000;

export const PASSWORD_PURPOSES = ['login', 'register', 'change_current', 'change_new', 'reset'] as const;
export type PasswordPurpose = (typeof PASSWORD_PURPOSES)[number];

export interface ParsedPasswordEnvelope {
  keyId: string;
  ts: number;
  blob: Buffer;
}

/** Lý do chuỗi mã hoá bị từ chối; chỉ để ghi log và test, client nhận một câu chung. */
export type PasswordEnvelopeFailure =
  'malformed' | 'unknown_key' | 'expired' | 'decrypt_failed' | 'replayed' | 'encryption_unavailable';

export class PasswordEnvelopeError extends Error {
  constructor(readonly reason: PasswordEnvelopeFailure) {
    super(`Không mở được mật khẩu đã mã hoá: ${reason}`);
    this.name = 'PasswordEnvelopeError';
  }
}

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidPasswordKeyId(keyId: string): boolean {
  return KEY_ID_PATTERN.test(keyId);
}

export function parsePasswordEnvelope(value: string): ParsedPasswordEnvelope {
  if (value.length > PASSWORD_ENVELOPE_MAX_LENGTH) throw new PasswordEnvelopeError('malformed');
  const parts = value.split(':');
  if (parts.length !== 5) throw new PasswordEnvelopeError('malformed');
  const [prefix, version, keyId, tsText, data] = parts as [string, string, string, string, string];
  if (prefix !== PASSWORD_ENVELOPE_PREFIX || version !== String(PASSWORD_ENVELOPE_VERSION)) {
    throw new PasswordEnvelopeError('malformed');
  }
  if (!isValidPasswordKeyId(keyId) || !/^\d{1,12}$/.test(tsText) || !BASE64URL_PATTERN.test(data)) {
    throw new PasswordEnvelopeError('malformed');
  }
  const blob = Buffer.from(data, 'base64url');
  if (blob.length < X25519_KEY_BYTES + AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES + 1) {
    throw new PasswordEnvelopeError('malformed');
  }
  return { keyId, ts: Number(tsText), blob };
}

/** Email để gắn vào AAD: chuẩn hoá giống lúc tra tài khoản; việc không có email (đổi, đặt lại mật khẩu) dùng chuỗi rỗng. */
export function passwordSubject(email: unknown): string {
  return typeof email === 'string' ? normalizeEmail(email) : '';
}

export function buildPasswordAad(
  purpose: PasswordPurpose,
  keyId: string,
  ts: number,
  subject: string,
): Buffer {
  return Buffer.from(
    `tripflix-pwd|${PASSWORD_ENVELOPE_VERSION}|${purpose}|${keyId}|${ts}|${subject}`,
    'utf8',
  );
}

/** ts tính bằng giây; quá cũ hay quá xa trong tương lai đều coi như hết hạn. */
export function isPasswordEnvelopeFresh(ts: number, nowSeconds: number): boolean {
  return (
    ts >= nowSeconds - PASSWORD_ENVELOPE_MAX_AGE_SECONDS &&
    ts <= nowSeconds + PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS
  );
}

export interface PasswordPlaintext {
  p: string;
  n: string;
  t: number;
}

export function parsePasswordPlaintext(raw: string, expectedTs: number): PasswordPlaintext {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PasswordEnvelopeError('malformed');
  }
  const v = value as Partial<PasswordPlaintext> | null;
  if (
    !v ||
    typeof v.p !== 'string' ||
    v.p.length > 1024 ||
    typeof v.n !== 'string' ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(v.n) ||
    v.t !== expectedTs
  ) {
    throw new PasswordEnvelopeError('malformed');
  }
  return { p: v.p, n: v.n, t: v.t };
}
