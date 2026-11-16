import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from '../env.js';
import { DB, ENV } from '../tokens.js';

/** Mỗi người giữ tối đa bấy nhiêu thiết bị; đăng ký thêm thì bỏ máy lâu nhất. */
export const MAX_PUSH_TOKENS_PER_USER = 10;
/** Expo nhận tối đa 100 tin mỗi lần gọi. */
const EXPO_BATCH_SIZE = 100;
const ROWS_PER_ROUND = 100;
/** Dòng gom chỉ đẩy lại sau khoảng này. */
const PUSH_COOLDOWN_SECONDS = 180;
/** Dòng đổi lâu hơn thế mà chưa đẩy (worker dừng) thì bỏ, không đẩy thông báo cũ. */
const PUSH_LOOKBACK_SECONDS = 600;

export const PushTokenSchema = z.string().max(200).regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/);
export const PushPlatformSchema = z.enum(['android', 'ios']);

const ExpoResponseSchema = z.object({
  data: z.array(z.object({
    status: z.enum(['ok', 'error']),
    message: z.string().optional(),
    details: z.object({ error: z.string().optional() }).passthrough().optional(),
  }).passthrough()),
});

interface PendingRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: { inboxId: string; link: string | null };
}

/**
 * N3: đẩy thông báo inbox mới hoặc dòng gom vừa có thêm người tới điện thoại qua Expo Push API.
 * Quét inbox theo updated_at thay vì gắn vào từng chỗ ghi inbox, để không sót loại thông báo nào.
 */
@Injectable()
export class PushWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PushWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<unknown>;

  constructor(@Inject(DB) private readonly pool: pg.Pool, @Inject(ENV) private readonly env: Env) {}

  onApplicationBootstrap(): void {
    if (!this.env.NOTIFICATION_CONSUMER_ENABLED || !this.env.PUSH_ENABLED) return;
    this.timer = setInterval(() => {
      this.pending ??= this.runOnce()
        .catch(() => { this.logger.error('Lỗi worker push'); })
        .finally(() => { this.pending = undefined; });
    }, 2_000);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
  }

  /** Token chuyển sang tài khoản mới khi đổi tài khoản trên cùng máy. */
  async registerToken(userId: string, token: string, platform: z.infer<typeof PushPlatformSchema>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
        [token, userId, platform],
      );
      await client.query(
        `DELETE FROM push_tokens WHERE user_id = $1 AND token NOT IN (
           SELECT token FROM push_tokens WHERE user_id = $1 ORDER BY updated_at DESC, token LIMIT $2)`,
        [userId, MAX_PUSH_TOKENS_PER_USER],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.pool.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, userId]);
  }

  /** Tài khoản bị khoá thì thôi đẩy tới mọi máy của người đó. */
  async removeUserTokens(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM push_tokens WHERE user_id = $1', [userId]);
  }

  /** Một lượt: lấy tối đa 100 dòng chờ đẩy, gửi Expo, ghi deliveries. Trả số dòng đã xử lý. */
  async runOnce(): Promise<number> {
    const client = await this.pool.connect();
    let locked = false;
    let unlockError: Error | undefined;
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('notification.push-worker')) AS acquired",
      );
      locked = lock.rows[0]?.acquired === true;
      if (!locked) return 0;
      const { rows } = await client.query<PendingRow>(
        `SELECT i.id, i.user_id, i.title, i.body, i.link FROM inbox AS i
         LEFT JOIN deliveries AS d ON d.inbox_id = i.id AND d.channel = 'push'
         WHERE i.updated_at > now() - make_interval(secs => $1)
           AND i.read_at IS NULL AND i.deleted_at IS NULL AND NOT i.is_post_interaction_suppressed
           AND EXISTS (SELECT 1 FROM push_tokens AS t WHERE t.user_id = i.user_id)
           AND (d.id IS NULL OR (d.updated_at < i.updated_at AND d.updated_at <= now() - make_interval(secs => $2)))
         ORDER BY i.updated_at LIMIT $3`,
        [PUSH_LOOKBACK_SECONDS, PUSH_COOLDOWN_SECONDS, ROWS_PER_ROUND],
      );
      if (!rows.length) return 0;
      await this.send(client, rows);
      return rows.length;
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('notification.push-worker'))");
        } catch {
          unlockError = new Error('Không nhả được khóa worker');
        }
      }
      client.release(unlockError);
    }
  }

  private async send(client: pg.PoolClient, rows: PendingRow[]): Promise<void> {
    const tokens = await client.query<{ token: string; user_id: string }>(
      'SELECT token, user_id FROM push_tokens WHERE user_id = ANY($1::uuid[])',
      [[...new Set(rows.map((row) => row.user_id))]],
    );
    const messages: { inboxId: string; message: ExpoMessage }[] = rows.flatMap((row) =>
      tokens.rows.filter((t) => t.user_id === row.user_id).map((t) => ({
        inboxId: row.id,
        message: { to: t.token, title: row.title, body: row.body, sound: 'default' as const, data: { inboxId: row.id, link: row.link } },
      })),
    );

    const sentInboxIds = new Set<string>();
    const errors = new Map<string, string>();
    const deadTokens: string[] = [];
    for (let start = 0; start < messages.length; start += EXPO_BATCH_SIZE) {
      const batch = messages.slice(start, start + EXPO_BATCH_SIZE);
      try {
        const tickets = await this.postToExpo(batch.map((item) => item.message));
        tickets.forEach((ticket, index) => {
          const item = batch[index];
          if (!item) return;
          if (ticket.status === 'ok') sentInboxIds.add(item.inboxId);
          else {
            errors.set(item.inboxId, ticket.details?.error ?? ticket.message ?? 'Expo từ chối');
            if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(item.message.to);
          }
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        batch.forEach((item) => errors.set(item.inboxId, reason));
        this.logger.warn({ err: error, count: batch.length }, 'Không gửi được lô push tới Expo');
      }
    }

    if (deadTokens.length) await client.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [deadTokens]);
    // Lỗi cũng ghi lại để chờ hết khoảng nghỉ rồi mới thử, không gọi dồn Expo khi Expo lỗi.
    await client.query(
      `INSERT INTO deliveries (inbox_id, user_id, channel, status, attempts, last_error)
       SELECT r.inbox_id, r.user_id, 'push', r.status, 1, r.last_error
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[]) AS r(inbox_id, user_id, status, last_error)
       ON CONFLICT (inbox_id) WHERE channel = 'push' DO UPDATE SET status = EXCLUDED.status,
         attempts = deliveries.attempts + 1, last_error = EXCLUDED.last_error, updated_at = now()`,
      [
        rows.map((row) => row.id),
        rows.map((row) => row.user_id),
        rows.map((row) => (sentInboxIds.has(row.id) ? 'sent' : 'failed')),
        rows.map((row) => (sentInboxIds.has(row.id) ? null : errors.get(row.id) ?? null)),
      ],
    );
  }

  private async postToExpo(messages: ExpoMessage[]) {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${this.env.EXPO_ACCESS_TOKEN}`;
    const response = await fetch(this.env.EXPO_PUSH_URL, {
      method: 'POST', headers, body: JSON.stringify(messages), redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Expo trả HTTP ${response.status}`);
    return ExpoResponseSchema.parse(await response.json()).data;
  }
}
