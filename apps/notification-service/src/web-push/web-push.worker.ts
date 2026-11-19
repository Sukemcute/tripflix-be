import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type AuthUser, type SidBlocklist } from '@tripflix/auth';
import type pg from 'pg';
// web-push 4 là ESM chỉ có named export; Node thật không có default (Vitest thì có).
import * as webPush from 'web-push';
import { DB, ENV, SID_BLOCKLIST_PROVIDER } from '../tokens.js';
import type { Env } from '../env.js';
import { toInboxItemDto, type InboxRow } from '../inbox/inbox.repository.js';
import { type SubscriptionSchema, webNotificationHref, webPushData } from './web-push.validation.js';
import type { z } from 'zod';

type Pending = InboxRow & {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  session_id: string;
  attempts: number;
};

@Injectable()
export class WebPushWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebPushWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<unknown>;
  constructor(
    @Inject(DB) private readonly pool: pg.Pool,
    @Inject(ENV) private readonly env: Env,
    @Inject(SID_BLOCKLIST_PROVIDER) private readonly blocklist: SidBlocklist,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.WEB_PUSH_ENABLED || !this.env.NOTIFICATION_CONSUMER_ENABLED) return;
    this.timer = setInterval(() => {
      this.pending ??= this.runOnce()
        .catch(() => this.logger.error('Worker Web Push không hoàn thành lượt gửi'))
        .finally(() => {
          this.pending = undefined;
        });
    }, 2000);
  }
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.pending;
  }

  async register(user: AuthUser, subscription: z.infer<typeof SubscriptionSchema>): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`web-push:${user.userId}`]);
      const result = await client.query<{ id: string }>(
        `INSERT INTO web_push_subscriptions(endpoint,user_id,session_id,p256dh,auth,expires_at)
         VALUES($1,$2,$3,$4,$5,to_timestamp($6)) ON CONFLICT(endpoint) DO UPDATE SET
         id = CASE WHEN web_push_subscriptions.user_id = EXCLUDED.user_id AND web_push_subscriptions.session_id = EXCLUDED.session_id
           THEN web_push_subscriptions.id ELSE gen_random_uuid() END,
         created_at = CASE WHEN web_push_subscriptions.user_id = EXCLUDED.user_id AND web_push_subscriptions.session_id = EXCLUDED.session_id
           THEN web_push_subscriptions.created_at ELSE now() END,
         user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,expires_at=EXCLUDED.expires_at
         RETURNING id`,
        [
          subscription.endpoint,
          user.userId,
          user.sid,
          subscription.keys.p256dh,
          subscription.keys.auth,
          user.exp,
        ],
      );
      await client.query(
        `DELETE FROM web_push_subscriptions WHERE user_id=$1 AND id NOT IN
        (SELECT id FROM web_push_subscriptions WHERE user_id=$1 ORDER BY (id=$2::uuid) DESC,expires_at DESC,created_at DESC LIMIT 10)`,
        [user.userId, result.rows[0]!.id],
      );
      await client.query('COMMIT');
      return result.rows[0]!.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async remove(userId: string, endpoint: string): Promise<void> {
    await this.pool.query('DELETE FROM web_push_subscriptions WHERE user_id=$1 AND endpoint=$2', [
      userId,
      endpoint,
    ]);
  }

  async runOnce(): Promise<number> {
    const client = await this.pool.connect();
    let locked = false;
    let releaseError: Error | undefined;
    try {
      locked =
        (
          await client.query<{ acquired: boolean }>(
            "SELECT pg_try_advisory_lock(hashtext('notification.web-push-worker')) AS acquired",
          )
        ).rows[0]?.acquired === true;
      if (!locked) return 0;
      await client.query(
        "DELETE FROM web_push_deliveries WHERE (subscription_id,notification_id) IN (SELECT subscription_id,notification_id FROM web_push_deliveries WHERE created_at < now() - interval '1 day' ORDER BY created_at LIMIT 1000)",
      );
      // Giữ đăng ký hết hạn một ngày để tab vừa thức dậy gia hạn mà không phát lại lịch sử.
      await client.query(
        "DELETE FROM web_push_subscriptions WHERE id IN (SELECT id FROM web_push_subscriptions WHERE expires_at < now() - interval '1 day' ORDER BY expires_at LIMIT 1000)",
      );
      const { rows } = await client.query<Pending>(`
        WITH candidates AS (
          SELECT i.id,i.user_id,i.type,i.title,i.body,i.link,i.data,i.created_at,i.read_at,
            s.id AS subscription_id,s.endpoint,s.p256dh,s.auth,s.session_id
          FROM inbox i JOIN web_push_subscriptions s ON s.user_id=i.user_id
          WHERE i.created_at >= s.created_at AND i.created_at > now()-interval '10 minutes'
            AND s.expires_at > now() AND i.read_at IS NULL AND i.deleted_at IS NULL AND NOT i.is_post_interaction_suppressed
            AND NOT EXISTS(SELECT 1 FROM follower_post_jobs j WHERE i.type='follow.post.published'
              AND j.post_id=(CASE WHEN i.type='follow.post.published' THEN i.data->>'postId' END)::uuid AND j.state='cancelled')
          UNION ALL
          SELECT j.post_id,f.follower_id,'follow.post.published','Có bài viết mới',
            COALESCE(NULLIF(btrim(actor.display_name),''),'Người bạn theo dõi') || ' vừa đăng bài mới.',
            '/trips/' || j.post_id,jsonb_build_object('postId',j.post_id,'actorIds',jsonb_build_array(f.author_id::text)),
            j.shared_created_at,NULL,s.id,s.endpoint,s.p256dh,s.auth,s.session_id
          FROM follower_post_jobs j JOIN notification_follows f ON f.author_id=j.author_id
          JOIN web_push_subscriptions s ON s.user_id=f.follower_id
          LEFT JOIN user_directory actor ON actor.user_id=f.author_id
          WHERE j.state='done' AND j.shared_created_at > now()-interval '10 minutes'
            AND j.shared_created_at >= s.created_at AND s.expires_at > now()
            AND f.followed_at IS NOT NULL AND j.shared_published_at >= f.followed_at
            AND NOT EXISTS(SELECT 1 FROM shared_follower_post_reads r WHERE r.user_id=f.follower_id AND r.post_id=j.post_id)
        )
        SELECT c.*,COALESCE(d.attempts,0) AS attempts FROM candidates c
        LEFT JOIN web_push_deliveries d ON d.subscription_id=c.subscription_id AND d.notification_id=c.id
        WHERE d.notification_id IS NULL OR (d.status='pending' AND d.attempts < 5 AND d.available_at <= now())
        ORDER BY c.created_at,c.id,c.subscription_id LIMIT 40`);
      // Bốn kết nối gửi tối đa mỗi lượt; không tạo hàng nghìn promise khi có nhiều người nhận.
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, rows.length) }, async () => {
          while (cursor < rows.length) {
            const row = rows[cursor++];
            if (row) await this.send(client, row);
          }
        }),
      );
      return rows.length;
    } finally {
      if (locked)
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('notification.web-push-worker'))");
        } catch {
          releaseError = new Error('Không nhả được khóa Web Push');
        }
      client.release(releaseError);
    }
  }

  private async send(client: pg.PoolClient, row: Pending): Promise<void> {
    if (await this.blocklist.isBlocked(row.session_id)) {
      await client.query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscription_id]);
      return;
    }
    let status = 'sent';
    try {
      await webPush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify({
          subscriptionId: row.subscription_id,
          userId: row.user_id,
          item: {
            ...toInboxItemDto(row),
            title: row.title.slice(0, 160),
            body: row.body.slice(0, 300),
            link: webNotificationHref(row, this.env.WEB_APP_URL),
            data: webPushData(row.data),
          },
          href: webNotificationHref(row, this.env.WEB_APP_URL),
        }),
        {
          vapidDetails: {
            subject: this.env.WEB_PUSH_SUBJECT!,
            publicKey: this.env.WEB_PUSH_PUBLIC_KEY!,
            privateKey: this.env.WEB_PUSH_PRIVATE_KEY!,
          },
          TTL: 300,
          timeout: 5000,
          urgency: 'normal',
        },
      );
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
      if (code === 404 || code === 410) {
        await client.query('DELETE FROM web_push_subscriptions WHERE id=$1', [row.subscription_id]);
        return;
      }
      status = (code === 0 || code === 429 || code >= 500) && row.attempts < 4 ? 'pending' : 'failed';
      // Không ghi endpoint, khóa hoặc nội dung cá nhân vào log.
      this.logger.warn({ statusCode: code }, 'Web Push chưa gửi được');
    }
    await client.query(
      `INSERT INTO web_push_deliveries(subscription_id,notification_id,attempts,status,available_at)
      SELECT $1,$2,1,$3,now()+make_interval(secs=>$4) WHERE EXISTS(SELECT 1 FROM web_push_subscriptions WHERE id=$1)
      ON CONFLICT(subscription_id,notification_id) DO UPDATE SET attempts=web_push_deliveries.attempts+1,
      status=EXCLUDED.status,available_at=EXCLUDED.available_at`,
      [row.subscription_id, row.id, status, Math.min(300, 10 * 2 ** row.attempts)],
    );
  }
}
