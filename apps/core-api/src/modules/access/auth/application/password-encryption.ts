import { Inject, Injectable } from '@nestjs/common';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import {
  PASSWORD_ENVELOPE_VERSION,
  PASSWORD_NONCE_TTL_SECONDS,
  PasswordEnvelopeError,
  buildPasswordAad,
  isPasswordEnvelopeFresh,
  parsePasswordEnvelope,
  parsePasswordPlaintext,
  type PasswordPurpose,
} from '../domain/password-envelope.js';
import {
  ACTION_RATE_LIMITER,
  CLOCK,
  PASSWORD_KEYRING,
  type ActionRateLimiter,
  type Clock,
  type PasswordKeyring,
  type PublicPasswordKey,
} from './ports.js';

export interface PasswordKeyView extends PublicPasswordKey {
  version: number;
  /** Giờ server (giây): client tính lệch đồng hồ để ts trong chuỗi mã hoá không bị coi là hết hạn. */
  serverTime: number;
}

/** Mở chuỗi mật khẩu đã mã hoá (TF056): đúng khoá, còn hạn, đúng mục đích và email, nonce chưa dùng. */
@Injectable()
export class PasswordEncryption {
  /** true: từ chối mật khẩu gửi thường; chỉ bật khi web, admin, mobile đều đã mã hoá. */
  readonly isRequired: boolean;

  constructor(
    @Inject(PASSWORD_KEYRING) private readonly keyring: PasswordKeyring | null,
    @Inject(ACTION_RATE_LIMITER) private readonly limiter: ActionRateLimiter,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(CORE_ENV) env: CoreEnv,
  ) {
    // E2E dựng env tay có thể thiếu biến này: mặc định như khi parse env.
    this.isRequired = (env.AUTH_PASSWORD_ENCRYPTION_REQUIRED as boolean | undefined) ?? false;
  }

  get isAvailable(): boolean {
    return this.keyring !== null;
  }

  publicKey(): PasswordKeyView | null {
    if (!this.keyring) return null;
    return { ...this.keyring.publicKey(), version: PASSWORD_ENVELOPE_VERSION, serverTime: this.nowSeconds() };
  }

  async open(value: string, purpose: PasswordPurpose, subject: string): Promise<string> {
    if (!this.keyring) throw new PasswordEnvelopeError('encryption_unavailable');
    const envelope = parsePasswordEnvelope(value);
    if (!isPasswordEnvelopeFresh(envelope.ts, this.nowSeconds())) throw new PasswordEnvelopeError('expired');
    const raw = this.keyring.decrypt(
      envelope,
      buildPasswordAad(purpose, envelope.keyId, envelope.ts, subject),
    );
    const plaintext = parsePasswordPlaintext(raw, envelope.ts);
    // Ghi nonce sau khi giải mã được, để chuỗi rác không làm đầy Redis. Lần thứ hai cùng nonce bị chặn.
    const nonce = await this.limiter.consume(`pwd-nonce:${plaintext.n}`, 1, PASSWORD_NONCE_TTL_SECONDS);
    if (nonce.isBlocked) throw new PasswordEnvelopeError('replayed');
    return plaintext.p;
  }

  private nowSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}
