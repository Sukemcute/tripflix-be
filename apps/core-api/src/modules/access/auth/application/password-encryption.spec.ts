import type { CoreEnv } from '../../../../platform/env.js';
import { PasswordEnvelopeError } from '../domain/password-envelope.js';
import { MemoryActionRateLimiter } from '../infra/memory/memory-action-rate-limiter.js';
import { encryptPasswordForTest } from '../infra/test-password-envelope.js';
import { X25519PasswordKeyring } from '../infra/x25519-password-keyring.js';
import { PasswordEncryption } from './password-encryption.js';

const NOW_MS = 1_794_300_000_000;
const NOW_S = NOW_MS / 1000;

function setup(
  keyring: X25519PasswordKeyring | null = X25519PasswordKeyring.ephemeral('k1'),
  required = false,
) {
  const passwords = new PasswordEncryption(keyring, new MemoryActionRateLimiter(), () => new Date(NOW_MS), {
    AUTH_PASSWORD_ENCRYPTION_REQUIRED: required,
  } as CoreEnv);
  return { passwords, key: keyring?.publicKey() };
}

async function reasonOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof PasswordEnvelopeError) return err.reason;
    throw err;
  }
  return undefined;
}

describe('PasswordEncryption', () => {
  it('trả khoá công khai kèm giờ server', () => {
    const { passwords, key } = setup();
    expect(passwords.publicKey()).toEqual({ ...key, version: 1, serverTime: NOW_S });
  });

  it('mở được chuỗi còn hạn, đúng mục đích và email', async () => {
    const { passwords, key } = setup();
    const envelope = encryptPasswordForTest(key!, 'mat-khau', {
      purpose: 'login',
      subject: 'lan@example.com',
      ts: NOW_S,
    });
    await expect(passwords.open(envelope, 'login', 'lan@example.com')).resolves.toBe('mat-khau');
  });

  it('gửi lại đúng chuỗi đó lần thứ hai: replayed', async () => {
    const { passwords, key } = setup();
    const envelope = encryptPasswordForTest(key!, 'mat-khau', { purpose: 'login', ts: NOW_S });
    await passwords.open(envelope, 'login', '');
    expect(await reasonOf(passwords.open(envelope, 'login', ''))).toBe('replayed');
  });

  it('chuỗi mới nhưng dùng lại nonce cũ: replayed', async () => {
    const { passwords, key } = setup();
    const nonce = Buffer.alloc(16, 9).toString('base64url');
    await passwords.open(
      encryptPasswordForTest(key!, 'a', { purpose: 'login', ts: NOW_S, nonce }),
      'login',
      '',
    );
    const again = encryptPasswordForTest(key!, 'a', { purpose: 'login', ts: NOW_S - 1, nonce });
    expect(await reasonOf(passwords.open(again, 'login', ''))).toBe('replayed');
  });

  it('quá 5 phút hoặc ts ở tương lai xa: expired', async () => {
    const { passwords, key } = setup();
    const old = encryptPasswordForTest(key!, 'a', { purpose: 'login', ts: NOW_S - 301 });
    const future = encryptPasswordForTest(key!, 'a', { purpose: 'login', ts: NOW_S + 61 });
    expect(await reasonOf(passwords.open(old, 'login', ''))).toBe('expired');
    expect(await reasonOf(passwords.open(future, 'login', ''))).toBe('expired');
  });

  it('chuỗi giải mã không được thì không ghi nonce (gửi chuỗi rác không làm đầy Redis)', async () => {
    const limiter = new MemoryActionRateLimiter();
    const consume = vi.spyOn(limiter, 'consume');
    const keyring = X25519PasswordKeyring.ephemeral('k1');
    const passwords = new PasswordEncryption(keyring, limiter, () => new Date(NOW_MS), {} as CoreEnv);
    const envelope = encryptPasswordForTest(keyring.publicKey(), 'a', { purpose: 'login', ts: NOW_S });
    expect(await reasonOf(passwords.open(envelope, 'reset', ''))).toBe('decrypt_failed');
    expect(consume).not.toHaveBeenCalled();
  });

  it('chưa có khoá (production chưa đặt AUTH_PASSWORD_KEYS): không có khoá công khai, mọi chuỗi bị từ chối', async () => {
    const { passwords } = setup(null);
    expect(passwords.isAvailable).toBe(false);
    expect(passwords.publicKey()).toBeNull();
    expect(await reasonOf(passwords.open('#TFPWD:1:k1:1:AAAA', 'login', ''))).toBe('encryption_unavailable');
  });

  it('isRequired đọc từ AUTH_PASSWORD_ENCRYPTION_REQUIRED, mặc định false', () => {
    expect(setup().passwords.isRequired).toBe(false);
    expect(setup(undefined, true).passwords.isRequired).toBe(true);
  });
});
