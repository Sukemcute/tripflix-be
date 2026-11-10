import {
  PASSWORD_ENVELOPE_MAX_AGE_SECONDS,
  PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS,
  PasswordEnvelopeError,
  buildPasswordAad,
  isPasswordEnvelopeFresh,
  parsePasswordEnvelope,
  parsePasswordPlaintext,
  passwordSubject,
} from './password-envelope.js';

const BLOB = Buffer.alloc(61, 7).toString('base64url');

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof PasswordEnvelopeError ? err.reason : 'other';
  }
  return undefined;
}

describe('parsePasswordEnvelope', () => {
  it('đọc đúng keyId, ts, dữ liệu', () => {
    const parsed = parsePasswordEnvelope(`#TFPWD:1:k1:1794300000:${BLOB}`);
    expect(parsed).toMatchObject({ keyId: 'k1', ts: 1794300000 });
    expect(parsed.blob).toHaveLength(61);
  });

  it('sai tiền tố, phiên bản, số phần, keyId, ts, base64url hoặc quá ngắn: malformed', () => {
    for (const value of [
      `#PWD:1:k1:1:${BLOB}`,
      `#TFPWD:2:k1:1:${BLOB}`,
      `#TFPWD:1:k1:${BLOB}`,
      `#TFPWD:1:k 1:1:${BLOB}`,
      `#TFPWD:1:k1:-5:${BLOB}`,
      `#TFPWD:1:k1:1:${BLOB}=`,
      `#TFPWD:1:k1:1:${Buffer.alloc(60).toString('base64url')}`,
      `#TFPWD:1:k1:1:${'A'.repeat(7000)}`,
      'mat-khau-thuong',
    ]) {
      expect(reasonOf(() => parsePasswordEnvelope(value))).toBe('malformed');
    }
  });
});

describe('isPasswordEnvelopeFresh', () => {
  const now = 1_794_300_000;
  it(`nhận chuỗi tạo trong ${PASSWORD_ENVELOPE_MAX_AGE_SECONDS} giây gần đây, đồng hồ client nhanh tối đa ${PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS} giây`, () => {
    expect(isPasswordEnvelopeFresh(now, now)).toBe(true);
    expect(isPasswordEnvelopeFresh(now - PASSWORD_ENVELOPE_MAX_AGE_SECONDS, now)).toBe(true);
    expect(isPasswordEnvelopeFresh(now - PASSWORD_ENVELOPE_MAX_AGE_SECONDS - 1, now)).toBe(false);
    expect(isPasswordEnvelopeFresh(now + PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS, now)).toBe(true);
    expect(isPasswordEnvelopeFresh(now + PASSWORD_ENVELOPE_MAX_FUTURE_SECONDS + 1, now)).toBe(false);
  });
});

describe('parsePasswordPlaintext', () => {
  const nonce = Buffer.alloc(16, 1).toString('base64url');
  it('nhận { p, n, t } với t khớp ts của chuỗi', () => {
    expect(parsePasswordPlaintext(JSON.stringify({ p: 'pw', n: nonce, t: 5 }), 5)).toEqual({
      p: 'pw',
      n: nonce,
      t: 5,
    });
  });

  it('JSON hỏng, thiếu trường, nonce ngắn, t lệch, mật khẩu quá dài: malformed', () => {
    for (const raw of [
      'không phải json',
      JSON.stringify({ n: nonce, t: 5 }),
      JSON.stringify({ p: 'pw', n: 'ngan', t: 5 }),
      JSON.stringify({ p: 'pw', n: nonce, t: 6 }),
      JSON.stringify({ p: 'x'.repeat(1025), n: nonce, t: 5 }),
      'null',
    ]) {
      expect(reasonOf(() => parsePasswordPlaintext(raw, 5))).toBe('malformed');
    }
  });
});

describe('AAD', () => {
  it('email chuẩn hoá giống lúc tra tài khoản; không có email thì chuỗi rỗng', () => {
    expect(passwordSubject('  Lan@Example.COM ')).toBe('lan@example.com');
    expect(passwordSubject(undefined)).toBe('');
    expect(passwordSubject(42)).toBe('');
    expect(buildPasswordAad('login', 'k1', 5, 'lan@example.com').toString()).toBe(
      'tripflix-pwd|1|login|k1|5|lan@example.com',
    );
  });
});
