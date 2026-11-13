import { and, asc, eq, gt, lte } from 'drizzle-orm';
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
