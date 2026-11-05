import { desc, eq } from 'drizzle-orm';
import type { Db } from '@tripflix/db';
import {
  moderationActions,
  type ModerationActionRecord,
  type NewModerationActionRecord,
} from '../../db/schema/index.js';

export class ModerationActionRepository {
  constructor(private readonly dbOrGetDb: Db | (() => Db)) {}

  private get db(): Db {
    return typeof this.dbOrGetDb === 'function' ? this.dbOrGetDb() : this.dbOrGetDb;
  }

  async create(data: NewModerationActionRecord): Promise<ModerationActionRecord> {
    const [inserted] = await this.db.insert(moderationActions).values(data).returning();
    if (!inserted) throw new Error('Không thể ghi nhật ký kiểm duyệt');
    return inserted;
  }

  async findByPostId(postId: string): Promise<ModerationActionRecord[]> {
    return this.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.postId, postId))
      .orderBy(desc(moderationActions.createdAt));
  }
}
