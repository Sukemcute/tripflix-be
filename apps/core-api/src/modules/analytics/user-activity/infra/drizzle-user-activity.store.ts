import type { Db } from '@tripflix/db';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { userActivityEvents } from '../../db/schema/index.js';
import type { UserActivityEventRow, UserActivityStore, UserActivitySummaryRow } from '../application/user-activity.use-cases.js';
import type { UserActivityCounts, UserActivityRecord, UserActivityWindow } from '../domain/user-activity.js';

const countKind = (kind: string) =>
  sql<number>`count(*) filter (where ${userActivityEvents.kind} = ${kind})::int`;

const countColumns = {
  reactions: countKind('reaction'),
  comments: countKind('comment'),
  shares: countKind('share'),
  views: countKind('view'),
  chats: countKind('chat'),
  lastActiveAt: sql<Date | null>`max(${userActivityEvents.occurredAt})`,
};

export class DrizzleUserActivityStore implements UserActivityStore {
  constructor(private readonly db: Db) {}

  async insert(record: UserActivityRecord): Promise<boolean> {
    const rows = await this.db
      .insert(userActivityEvents)
      .values(record)
      .onConflictDoNothing({ target: userActivityEvents.id })
      .returning({ id: userActivityEvents.id });
    return rows.length > 0;
  }

  async summarize({ from, to, limit, offset }: UserActivityWindow & { limit: number; offset: number }) {
    const inWindow = and(gte(userActivityEvents.occurredAt, from), lt(userActivityEvents.occurredAt, to));
    const rows = await this.db
      .select({ userId: userActivityEvents.userId, ...countColumns })
      .from(userActivityEvents)
      .where(inWindow)
      .groupBy(userActivityEvents.userId)
      .orderBy(desc(sql`max(${userActivityEvents.occurredAt})`), userActivityEvents.userId)
      .limit(limit)
      .offset(offset);
    const [totalRow] = await this.db
      .select({ total: sql<number>`count(distinct ${userActivityEvents.userId})::int` })
      .from(userActivityEvents)
      .where(inWindow);
    return { rows: rows.map(toSummaryRow), total: Number(totalRow?.total ?? 0) };
  }

  async summarizeUser(userId: string, { from, to }: UserActivityWindow): Promise<UserActivityCounts> {
    const [row] = await this.db
      .select(countColumns)
      .from(userActivityEvents)
      .where(
        and(
          eq(userActivityEvents.userId, userId),
          gte(userActivityEvents.occurredAt, from),
          lt(userActivityEvents.occurredAt, to),
        ),
      );
    return toCounts(row);
  }

  async recentEvents(userId: string, { from, to }: UserActivityWindow, limit: number): Promise<UserActivityEventRow[]> {
    return this.db
      .select({
        id: userActivityEvents.id,
        kind: userActivityEvents.kind,
        occurredAt: userActivityEvents.occurredAt,
        targetId: userActivityEvents.targetId,
        detail: userActivityEvents.detail,
      })
      .from(userActivityEvents)
      .where(
        and(
          eq(userActivityEvents.userId, userId),
          gte(userActivityEvents.occurredAt, from),
          lt(userActivityEvents.occurredAt, to),
        ),
      )
      .orderBy(desc(userActivityEvents.occurredAt))
      .limit(limit);
  }

  async purgeBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(userActivityEvents)
      .where(lt(userActivityEvents.occurredAt, cutoff))
      .returning({ id: userActivityEvents.id });
    return rows.length;
  }
}

function toCounts(row: {
  reactions: number;
  comments: number;
  shares: number;
  views: number;
  chats: number;
  lastActiveAt: Date | null;
} | undefined): UserActivityCounts {
  return {
    reactions: Number(row?.reactions ?? 0),
    comments: Number(row?.comments ?? 0),
    shares: Number(row?.shares ?? 0),
    views: Number(row?.views ?? 0),
    chats: Number(row?.chats ?? 0),
    lastActiveAt: row?.lastActiveAt ?? null,
  };
}

function toSummaryRow(row: { userId: string } & Parameters<typeof toCounts>[0] & object): UserActivitySummaryRow {
  return { userId: row.userId, ...toCounts(row) };
}
