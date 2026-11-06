import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Db } from '@tripflix/db';
import { deletePublishedBefore } from '@tripflix/outbox';
import type { CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV, DB_POOLS, type DbPools } from '../../../../platform/tokens.js';
import { accessOutboxEvents } from '../../db/schema/index.js';
import {
  ACCESS_STORE,
  CLOCK,
  type AccessStore,
  type Clock,
  type OneTimeTokenRepository,
  type RegistrationChallengeRepository,
  type SessionRepository,
} from '../application/ports.js';

export const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Giữ sự kiện đã gửi 7 ngày để còn tra cứu khi consumer báo thiếu. */
export const PUBLISHED_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AccessCleanupResult {
  expiredSessions: number;
  expiredPasswordResets: number;
  expiredEmailVerifications: number;
  expiredRegistrationChallenges: number;
  publishedEvents: number;
}

/** Một lượt dọn: phiên, token đặt lại mật khẩu, link xác thực email đã hết hạn và dòng outbox đã gửi quá 7 ngày. */
export async function runAccessCleanup(deps: {
  sessions: Pick<SessionRepository, 'deleteExpired'>;
  passwordResets: Pick<OneTimeTokenRepository, 'deleteExpired'>;
  emailVerifications: Pick<OneTimeTokenRepository, 'deleteExpired'>;
  registrationChallenges: Pick<RegistrationChallengeRepository, 'deleteExpired'>;
  db: Db;
  now: Date;
}): Promise<AccessCleanupResult> {
  const expiredSessions = await deps.sessions.deleteExpired(deps.now);
  const expiredPasswordResets = await deps.passwordResets.deleteExpired(deps.now);
  const expiredEmailVerifications = await deps.emailVerifications.deleteExpired(deps.now);
  const expiredRegistrationChallenges = await deps.registrationChallenges.deleteExpired(deps.now);
  const publishedEvents = await deletePublishedBefore(
    deps.db,
    accessOutboxEvents,
    new Date(deps.now.getTime() - PUBLISHED_EVENT_RETENTION_MS),
  );
  return { expiredSessions, expiredPasswordResets, expiredEmailVerifications, expiredRegistrationChallenges, publishedEvents };
}

/**
 * Job dọn dữ liệu của access: chạy lúc khởi động rồi mỗi 24 giờ, chỉ khi APP_ROLE là worker hoặc all.
 * Dùng setInterval, không cần thư viện hẹn giờ. Chạy lại nhiều lần hay nhiều worker cùng chạy đều an toàn (chỉ DELETE).
 */
@Injectable()
export class AccessCleanupJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AccessCleanupJob');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;

  constructor(
    @Inject(CORE_ENV) private readonly env: CoreEnv,
    @Inject(DB_POOLS) private readonly pools: DbPools,
    @Inject(ACCESS_STORE) private readonly store: AccessStore,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.APP_ROLE !== 'worker' && this.env.APP_ROLE !== 'all') return;
    const db = createDb(this.pools.access);
    const tick = () => {
      // Lượt trước chưa xong thì bỏ lượt này.
      this.running ??= this.runOnce(db).finally(() => {
        this.running = undefined;
      });
    };
    tick();
    this.timer = setInterval(tick, CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  private async runOnce(db: Db): Promise<void> {
    try {
      const result = await runAccessCleanup({
        sessions: this.store.sessions,
        passwordResets: this.store.passwordResets,
        emailVerifications: this.store.emailVerifications,
        registrationChallenges: this.store.registrationChallenges,
        db,
        now: this.now(),
      });
      this.logger.log(result, 'Đã dọn phiên, token đặt lại mật khẩu, link xác thực email hết hạn và sự kiện access đã gửi quá 7 ngày');
    } catch (err) {
      this.logger.error({ err }, 'Dọn dữ liệu access lỗi, sẽ thử lại ở lượt sau');
    }
  }
}
