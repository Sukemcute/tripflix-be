import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { startPostgres, type PostgresFixture } from '@tripflix/testing';
import { MemorySidBlocklist, type AuthUser } from '@tripflix/auth';
import pg from 'pg';
import webPush from 'web-push';
import { envSchema } from '../env.js';
import { InboxRepository } from '../inbox/inbox.repository.js';
import { WebPushWorker } from './web-push.worker.js';

vi.mock('web-push', () => ({
  default: { sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) },
}));
const subscription = (name: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
    auth: Buffer.alloc(16, 2).toString('base64url'),
  },
});
const identity = (): AuthUser => ({
  userId: randomUUID(),
  sid: randomUUID(),
  role: 'member',
  exp: Math.floor(Date.now() / 1000) + 900,
});

describe('Web Push: PostgreSQL và gửi có kiểm soát', () => {
  let fixture: PostgresFixture;
  let pool: pg.Pool;
  let worker: WebPushWorker;
  let blocklist: MemorySidBlocklist;
  beforeAll(async () => {
    fixture = await startPostgres();
    pool = new pg.Pool({ connectionString: fixture.buildModuleUrl('notification') });
    await new InboxRepository(pool).onModuleInit();
    blocklist = new MemorySidBlocklist();
    worker = new WebPushWorker(pool, envSchema.parse({ DATABASE_URL_NOTIFICATION: 'test' }), blocklist);
  });
  afterAll(async () => {
    await pool?.end();
    await fixture?.stop();
  });
  beforeEach(async () => {
    vi.mocked(webPush.sendNotification)
      .mockReset()
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await pool.query('DELETE FROM web_push_subscriptions');
  });
  async function add(userId: string, body = 'Nội dung mới') {
    return (
      await pool.query<{ id: string }>(
        `INSERT INTO inbox(user_id,type,title,body,link,source_event_id)
      VALUES($1,'comment.replied','Trang trả lời bình luận',$2,'/inspiration?open=p&comment=c',$3) RETURNING id`,
        [userId, body, randomUUID()],
      )
    ).rows[0]!.id;
  }
  it('gửi một lần tới từng máy, không phát lại lịch sử hoặc bản cập nhật dòng gom', async () => {
    const user = identity();
    await add(user.userId);
    await worker.register(user, subscription('a'));
    await worker.register(user, subscription('b'));
    const id = await add(user.userId);
    expect(await worker.runOnce()).toBe(2);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
    expect(JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1]! as string)).toMatchObject({
      userId: user.userId,
      item: { id },
    });
    await pool.query('UPDATE inbox SET body=$2 WHERE id=$1', [id, 'Thêm người khác']);
    expect(await worker.runOnce()).toBe(0);
  });
  it('gia hạn giữ nguyên id, đổi tài khoản đổi id và không gửi nội dung tài khoản cũ', async () => {
    const first = identity(),
      second = identity();
    const oldId = await worker.register(first, subscription('switch'));
    expect(await worker.register(first, subscription('switch'))).toBe(oldId);
    await add(first.userId);
    await worker.runOnce();
    const nextId = await worker.register(second, subscription('switch'));
    expect(nextId).not.toBe(oldId);
    await add(first.userId);
    const id = await add(second.userId);
    vi.mocked(webPush.sendNotification).mockClear();
    await worker.runOnce();
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1]! as string)).toMatchObject({
      subscriptionId: nextId,
      userId: second.userId,
      item: { id },
    });
  });
  it('xóa thiết bị chỉ theo chủ sở hữu, giới hạn 10 máy', async () => {
    const user = identity();
    for (let n = 0; n < 12; n++) await worker.register(user, subscription(`cap-${n}`));
    await worker.remove(randomUUID(), subscription('cap-11').endpoint);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM web_push_subscriptions WHERE user_id=$1', [
          user.userId,
        ])
      ).rows[0].count,
    ).toBe(10);
    await worker.remove(user.userId, subscription('cap-11').endpoint);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM web_push_subscriptions WHERE user_id=$1', [
          user.userId,
        ])
      ).rows[0].count,
    ).toBe(9);
  });
  it('máy vừa đăng ký vẫn được giữ khi token còn hạn ngắn hơn các máy cũ', async () => {
    const user = identity();
    for (let n = 0; n < 10; n++) await worker.register(user, subscription(`lease-${n}`));
    const id = await worker.register(
      { ...user, exp: Math.floor(Date.now() / 1000) + 60 },
      subscription('lease-new'),
    );
    expect((await pool.query('SELECT 1 FROM web_push_subscriptions WHERE id=$1', [id])).rowCount).toBe(1);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM web_push_subscriptions WHERE user_id=$1', [
          user.userId,
        ])
      ).rows[0].count,
    ).toBe(10);
  });
  it('không gửi cho phiên hết hạn, bị thu hồi hoặc thông báo đã đọc/ẩn', async () => {
    const expired = identity(),
      revoked = identity(),
      read = identity();
    await worker.register({ ...expired, exp: Math.floor(Date.now() / 1000) - 1 }, subscription('expired'));
    await worker.register(revoked, subscription('revoked'));
    await blocklist.block(revoked.sid, 900);
    await worker.register(read, subscription('read'));
    await add(expired.userId);
    await add(revoked.userId);
    const id = await add(read.userId);
    await pool.query('UPDATE inbox SET read_at=now() WHERE id=$1', [id]);
    const hidden = await add(read.userId);
    await pool.query('UPDATE inbox SET is_post_interaction_suppressed=true WHERE id=$1', [hidden]);
    await worker.runOnce();
    expect(webPush.sendNotification).not.toHaveBeenCalled();
  });
  it('410 xóa endpoint chết; 429 giãn nhịp và dừng sau 5 lần', async () => {
    const user = identity();
    await worker.register(user, subscription('retry'));
    await add(user.userId);
    vi.mocked(webPush.sendNotification).mockRejectedValue({ statusCode: 429 });
    await worker.runOnce();
    expect(await worker.runOnce()).toBe(0);
    for (let n = 1; n < 5; n++) {
      await pool.query("UPDATE web_push_deliveries SET available_at=now()-interval '1 second'");
      await worker.runOnce();
    }
    expect(webPush.sendNotification).toHaveBeenCalledTimes(5);
    expect(await worker.runOnce()).toBe(0);
    await worker.register(identity(), subscription('dead'));
    const owner = (
      await pool.query("SELECT user_id FROM web_push_subscriptions WHERE endpoint LIKE '%/dead'")
    ).rows[0].user_id;
    await add(owner);
    vi.mocked(webPush.sendNotification).mockRejectedValue({ statusCode: 410 });
    await worker.runOnce();
    expect(
      (await pool.query("SELECT 1 FROM web_push_subscriptions WHERE endpoint LIKE '%/dead'")).rowCount,
    ).toBe(0);
  });
  it('khóa liên replica không gửi trùng khi hai worker chạy đồng thời', async () => {
    const user = identity();
    await worker.register(user, subscription('parallel'));
    await add(user.userId);
    vi.mocked(webPush.sendNotification).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { statusCode: 201, body: '', headers: {} };
    });
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
  });
  it('bài follower dùng chung chỉ gửi cho người đã theo dõi trước khi đăng', async () => {
    const user = identity(),
      late = identity(),
      author = randomUUID(),
      post = randomUUID();
    await worker.register(user, subscription('follower'));
    await worker.register(late, subscription('late'));
    await pool.query(
      "INSERT INTO notification_follows(follower_id,author_id,followed_at,changed_at) VALUES($1,$2,now()-interval '1 day',now()),($3,$2,now()+interval '1 day',now())",
      [user.userId, author, late.userId],
    );
    await pool.query(
      "INSERT INTO follower_post_jobs(post_id,author_id,state,shared_published_at,shared_created_at) VALUES($1,$2,'done',now(),now())",
      [post, author],
    );
    await worker.runOnce();
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(webPush.sendNotification).mock.calls[0]![1]! as string)).toMatchObject({
      userId: user.userId,
      item: { id: post, type: 'follow.post.published' },
    });
  });
});
