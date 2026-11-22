import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import { posts, savedItineraries, type SavedItineraryRecord } from '../../db/schema/index.js';
import type { SavedItineraryDraft } from '../domain/saved-itinerary.js';
import type { ReelForItinerary, SavedItineraryChanges, SavedItineraryStore } from '../application/saved-itinerary.use-cases.js';

export class DrizzleSavedItineraryStore implements SavedItineraryStore {
  constructor(private readonly db: Db) {}

  async listOfUser(userId: string, options: { sourcePostId?: string; limit: number }): Promise<SavedItineraryRecord[]> {
    return this.db
      .select()
      .from(savedItineraries)
      .where(and(eq(savedItineraries.userId, userId), options.sourcePostId ? eq(savedItineraries.sourcePostId, options.sourcePostId) : undefined))
      .orderBy(desc(savedItineraries.updatedAt), desc(savedItineraries.id))
      .limit(options.limit);
  }

  async findOfUser(userId: string, id: string): Promise<SavedItineraryRecord | null> {
    const [row] = await this.db.select().from(savedItineraries).where(and(eq(savedItineraries.id, id), eq(savedItineraries.userId, userId)));
    return row ?? null;
  }

  async insert(userId: string, draft: SavedItineraryDraft): Promise<SavedItineraryRecord> {
    // Reel đã lưu rồi thì trả bản cũ (bấm Lưu hai lần, hai máy cùng bấm), không tạo bản trùng.
    const [row] = await this.db
      .insert(savedItineraries)
      .values({ userId, ...draft })
      .onConflictDoNothing({ target: [savedItineraries.userId, savedItineraries.sourcePostId], where: sql`${savedItineraries.sourcePostId} is not null` })
      .returning();
    if (row) return row;
    const [existing] = await this.listOfUser(userId, { sourcePostId: draft.sourcePostId ?? undefined, limit: 1 });
    if (!existing) throw new Error('Không lưu được lộ trình');
    return existing;
  }

  async update(userId: string, id: string, changes: SavedItineraryChanges): Promise<SavedItineraryRecord | null> {
    const [row] = await this.db
      .update(savedItineraries)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(savedItineraries.id, id), eq(savedItineraries.userId, userId)))
      .returning();
    return row ?? null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.delete(savedItineraries).where(and(eq(savedItineraries.id, id), eq(savedItineraries.userId, userId))).returning({ id: savedItineraries.id });
    return rows.length > 0;
  }

  async findReel(postId: string): Promise<ReelForItinerary | null> {
    const [row] = await this.db
      .select({ id: posts.id, title: posts.title, authorId: posts.authorId, status: posts.status, visibility: posts.visibility, tripAttachment: posts.tripAttachment })
      .from(posts)
      .where(eq(posts.id, postId));
    return row ?? null;
  }
}
