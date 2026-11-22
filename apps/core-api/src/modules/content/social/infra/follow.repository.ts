import { and, asc, count, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { follows } from '../../db/schema/index.js';

export const FOLLOWER_PAGE_SIZE = 200;

export class FollowRepository {
  constructor(private readonly executor: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.executor === 'function' ? this.executor() : this.executor;
  }

  private match(followerId: string, authorId: string) {
    return and(eq(follows.followerId, followerId), eq(follows.authorId, authorId));
  }

  async isFollowing(followerId: string, authorId: string): Promise<boolean> {
    const rows = await this.db.select({ followerId: follows.followerId }).from(follows)
      .where(this.match(followerId, authorId)).limit(1);
    return rows.length > 0;
  }

  async follow(followerId: string, authorId: string) {
    const [row] = await this.db.insert(follows).values({ followerId, authorId }).onConflictDoNothing().returning();
    return row;
  }

  async unfollow(followerId: string, authorId: string) {
    const [row] = await this.db.delete(follows).where(this.match(followerId, authorId)).returning();
    return row;
  }

  async countFor(userId: string): Promise<{ followerCount: number; followingCount: number }> {
    const [[followers], [following]] = await Promise.all([
      this.db.select({ n: count() }).from(follows).where(eq(follows.authorId, userId)),
      this.db.select({ n: count() }).from(follows).where(eq(follows.followerId, userId)),
    ]);
    return { followerCount: followers?.n ?? 0, followingCount: following?.n ?? 0 };
  }

  /** Như countFor nhưng cho nhiều người một lần; người không có ai theo dõi thì không có trong Map. */
  async countForMany(userIds: string[]): Promise<Map<string, { followerCount: number; followingCount: number }>> {
    const result = new Map<string, { followerCount: number; followingCount: number }>();
    if (userIds.length === 0) return result;
    const [followers, following] = await Promise.all([
      this.db.select({ userId: follows.authorId, n: count() }).from(follows)
        .where(inArray(follows.authorId, userIds)).groupBy(follows.authorId),
      this.db.select({ userId: follows.followerId, n: count() }).from(follows)
        .where(inArray(follows.followerId, userIds)).groupBy(follows.followerId),
    ]);
    const entry = (userId: string) => {
      const current = result.get(userId) ?? { followerCount: 0, followingCount: 0 };
      result.set(userId, current);
      return current;
    };
    for (const row of followers) entry(row.userId).followerCount = Number(row.n);
    for (const row of following) entry(row.userId).followingCount = Number(row.n);
    return result;
  }

  async reachesThreshold(authorId: string, threshold: number): Promise<boolean> {
    const rows = await this.db.select({ id: follows.followerId }).from(follows)
      .where(eq(follows.authorId, authorId)).orderBy(asc(follows.followerId)).offset(threshold - 1).limit(1);
    return rows.length > 0;
  }

  async listEligible(authorId: string, publishedAt: Date, cursor?: string) {
    const rows = await this.db.select({ followerId: follows.followerId }).from(follows)
      .where(and(eq(follows.authorId, authorId), lte(follows.followedAt, publishedAt),
        cursor ? gt(follows.followerId, cursor) : undefined))
      .orderBy(asc(follows.followerId)).limit(FOLLOWER_PAGE_SIZE + 1);
    const recipients = rows.slice(0, FOLLOWER_PAGE_SIZE).map((row) => row.followerId);
    return { recipients, nextCursor: rows.length > FOLLOWER_PAGE_SIZE ? recipients.at(-1)! : null };
  }
}
