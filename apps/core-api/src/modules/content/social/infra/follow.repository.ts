import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { follows } from '../../db/schema/index.js';

export const FOLLOWER_PAGE_SIZE = 200;

export class FollowRepository {
  constructor(private readonly db: Db) {}

  private match(followerId: string, authorId: string) {
    return and(eq(follows.followerId, followerId), eq(follows.authorId, authorId));
  }

  async isFollowing(followerId: string, authorId: string): Promise<boolean> {
    const rows = await this.db.select({ followerId: follows.followerId }).from(follows)
      .where(this.match(followerId, authorId)).limit(1);
    return rows.length > 0;
  }

  async follow(followerId: string, authorId: string): Promise<void> {
    await this.db.insert(follows).values({ followerId, authorId }).onConflictDoNothing();
  }

  async unfollow(followerId: string, authorId: string): Promise<void> {
    await this.db.delete(follows).where(this.match(followerId, authorId));
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
