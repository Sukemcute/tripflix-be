import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Transactional } from '@tripflix/db';
import { asc, eq } from 'drizzle-orm';
import { moderationKeywordRules } from '../../db/schema/index.js';
import { normalizeCommentKeyword } from '../../social/domain/comment-filter.js';
import { ModerationRepository } from '../infra/moderation.repository.js';

@Injectable()
export class KeywordRulesUseCases {
  constructor(@Inject(ModerationRepository) private readonly repository: ModerationRepository) {}

  list() {
    return this.repository.db.select().from(moderationKeywordRules).orderBy(asc(moderationKeywordRules.keyword));
  }

  @Transactional('content')
  async remove(id: string): Promise<void> {
    await this.repository.db.delete(moderationKeywordRules).where(eq(moderationKeywordRules.id, id));
  }

  @Transactional('content')
  async create(input: { keyword: string; enabled: boolean }, updatedBy: string) {
    const [rule] = await this.repository.db
      .insert(moderationKeywordRules)
      .values({ ...input, normalizedKeyword: normalizeCommentKeyword(input.keyword), updatedBy })
      .onConflictDoNothing({ target: moderationKeywordRules.normalizedKeyword })
      .returning();
    if (!rule) throw new ConflictException('Từ khóa này đã tồn tại');
    return rule;
  }

  @Transactional('content')
  async update(id: string, input: { keyword?: string | undefined; enabled?: boolean | undefined }, updatedBy: string) {
    try {
      const [rule] = await this.repository.db
        .update(moderationKeywordRules)
        .set({
          ...input,
          ...(input.keyword === undefined ? {} : { normalizedKeyword: normalizeCommentKeyword(input.keyword) }),
          updatedBy,
          updatedAt: new Date(),
        })
        .where(eq(moderationKeywordRules.id, id))
        .returning();
      if (!rule) throw new NotFoundException('Không tìm thấy quy tắc từ khóa');
      return rule;
    } catch (error) {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (typeof cause === 'object' && cause && 'code' in cause && cause.code === '23505') {
        throw new ConflictException('Từ khóa này đã tồn tại');
      }
      throw error;
    }
  }
}
