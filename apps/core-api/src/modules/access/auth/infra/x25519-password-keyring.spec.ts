import {
  PasswordEnvelopeError,
  buildPasswordAad,
  parsePasswordEnvelope,
  parsePasswordPlaintext,
} from '../domain/password-envelope.js';
import { encryptPasswordForTest } from './test-password-envelope.js';
import { X25519PasswordKeyring, generatePasswordKey, parsePasswordKeys } from './x25519-password-keyring.js';

const TS = 1_794_300_000;

function open(
  keyring: X25519PasswordKeyring,
  envelope: string,
  purpose: Parameters<typeof buildPasswordAad>[0],
  subject: string,
) {
  const parsed = parsePasswordEnvelope(envelope);
  return parsePasswordPlaintext(
    keyring.decrypt(parsed, buildPasswordAad(purpose, parsed.keyId, parsed.ts, subject)),
    parsed.ts,
  );
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof PasswordEnvelopeError) return err.reason;
    throw err;
  }
  return undefined;
}

describe('X25519PasswordKeyring', () => {
  const keyring = X25519PasswordKeyring.fromConfig(`k1:${generatePasswordKey()}`);
  const key = keyring.publicKey();

  it('giải mã đúng chuỗi client mã hoá, kể cả mật khẩu tiếng Việt, emoji', () => {
    for (const password of ['mat-khau-an-toan', 'Mật khẩu có dấu 🙂', ' khoảng trắng hai đầu ']) {
      const envelope = encryptPasswordForTest(key, password, {
        purpose: 'login',
        subject: 'lan@example.com',
        ts: TS,
      });
      expect(open(keyring, envelope, 'login', 'lan@example.com').p).toBe(password);
    }
  });

  it('chuỗi mã hoá không chứa mật khẩu gốc', () => {
    const envelope = encryptPasswordForTest(key, 'mat-khau-an-toan', { purpose: 'login', ts: TS });
    expect(envelope).toMatch(/^#TFPWD:1:k1:1794300000:[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain('mat-khau');
    expect(Buffer.from(envelope.split(':')[4]!, 'base64url').toString('latin1')).not.toContain('mat-khau');
  });

  it('sai mục đích, sai email hoặc sửa ts trong chuỗi: không giải mã được (AAD)', () => {
    const envelope = encryptPasswordForTest(key, 'pw', {
      purpose: 'login',
      subject: 'lan@example.com',
      ts: TS,
    });
    expect(reasonOf(() => open(keyring, envelope, 'change_new', 'lan@example.com'))).toBe('decrypt_failed');
    expect(reasonOf(() => open(keyring, envelope, 'login', 'minh@example.com'))).toBe('decrypt_failed');
    const parts = envelope.split(':');
    parts[3] = String(TS + 1);
    expect(reasonOf(() => open(keyring, parts.join(':'), 'login', 'lan@example.com'))).toBe('decrypt_failed');
  });

  it('sửa một byte bất kỳ (khoá tạm, iv, dữ liệu, tag): không giải mã được', () => {
    const envelope = encryptPasswordForTest(key, 'pw', { purpose: 'login', ts: TS });
    const parts = envelope.split(':');
    const blob = Buffer.from(parts[4]!, 'base64url');
    for (const index of [0, 31, 32, 43, 44, blob.length - 1]) {
      const tampered = Buffer.from(blob);
      tampered[index]! ^= 0x01;
      parts[4] = tampered.toString('base64url');
      expect(reasonOf(() => open(keyring, parts.join(':'), 'login', ''))).toBe('decrypt_failed');
    }
  });

  it('khoá công khai tạm là điểm cấp thấp (toàn số 0): từ chối', () => {
    const envelope = encryptPasswordForTest(key, 'pw', { purpose: 'login', ts: TS });
    const parts = envelope.split(':');
    const blob = Buffer.from(parts[4]!, 'base64url');
    blob.fill(0, 0, 32);
    parts[4] = blob.toString('base64url');
    expect(reasonOf(() => open(keyring, parts.join(':'), 'login', ''))).toBe('decrypt_failed');
  });

  it('keyId không có trong cấu hình: unknown_key; khoá khác: decrypt_failed', () => {
    const other = X25519PasswordKeyring.fromConfig(`k2:${generatePasswordKey()}`);
    const envelope = encryptPasswordForTest(other.publicKey(), 'pw', { purpose: 'login', ts: TS });
    expect(reasonOf(() => open(keyring, envelope, 'login', ''))).toBe('unknown_key');
    const sameIdOtherKey = X25519PasswordKeyring.fromConfig(`k1:${generatePasswordKey()}`);
    const forged = encryptPasswordForTest(sameIdOtherKey.publicKey(), 'pw', { purpose: 'login', ts: TS });
    expect(reasonOf(() => open(keyring, forged, 'login', ''))).toBe('decrypt_failed');
  });

  it('đổi khoá: khoá đầu là khoá đang dùng, khoá cũ vẫn giải mã được chuỗi mã hoá trước lúc đổi', () => {
    const oldKey = generatePasswordKey();
    const before = X25519PasswordKeyring.fromConfig(`k1:${oldKey}`);
    const envelope = encryptPasswordForTest(before.publicKey(), 'pw', { purpose: 'login', ts: TS });
    const rotated = X25519PasswordKeyring.fromConfig(`k2:${generatePasswordKey()},k1:${oldKey}`);
    expect(rotated.publicKey().keyId).toBe('k2');
    expect(open(rotated, envelope, 'login', '').p).toBe('pw');
  });

  it('cùng khoá thì cùng khoá công khai (nhiều replica dùng chung AUTH_PASSWORD_KEYS)', () => {
    const raw = generatePasswordKey();
    expect(X25519PasswordKeyring.fromConfig(`k1:${raw}`).publicKey()).toEqual(
      X25519PasswordKeyring.fromConfig(`k1:${raw}`).publicKey(),
    );
    expect(Buffer.from(key.publicKey, 'base64url')).toHaveLength(32);
  });

  it('AUTH_PASSWORD_KEYS sai dạng: báo lỗi lúc khởi động', () => {
    expect(() => parsePasswordKeys('')).toThrow();
    expect(() => parsePasswordKeys('k1')).toThrow();
    expect(() => parsePasswordKeys('k1:ngan-qua')).toThrow();
    expect(() => parsePasswordKeys(`k 1:${generatePasswordKey()}`)).toThrow();
    const raw = generatePasswordKey();
    expect(() => parsePasswordKeys(`k1:${raw},k1:${generatePasswordKey()}`)).toThrow(/trùng/);
    expect(parsePasswordKeys(` k1:${raw} , `)).toHaveLength(1);
  });
});
