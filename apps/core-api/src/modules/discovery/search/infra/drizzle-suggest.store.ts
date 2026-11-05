import type { Db } from '@tripflix/db';
import { and, asc, desc, inArray, or, sql } from 'drizzle-orm';
import { searchEntities, type SearchEntityRow } from '../../db/schema/index.js';
import type { SuggestEntity, SuggestType } from '../domain/suggest-entity.js';
import type { SuggestStore } from '../application/ports.js';

/**
 * Ngưỡng word_similarity của pg_trgm để chấp nhận gõ sai nhẹ: "nha trag" → Nha Trang (0,78), "da nag" → Đà Nẵng (0,71),
 * gõ thiếu nguyên âm "da nng" → Đà Nẵng (0,57). Đo trên dữ liệu seed: dưới 0,5 kéo theo nhiều dòng lạc
 * ("can tho" → Phú Thọ 0,50, "da lat" → Đắk Lắk 0,44). Dòng lạc trên ngưỡng vẫn đứng sau vì xếp theo điểm.
 */
const MIN_WORD_SIMILARITY = 0.55;
/** Câu ngắn hơn ("hn", "pq", "dad") ít trigram, tìm gần đúng ra rác: chỉ khớp đầu từ. */
const MIN_FUZZY_QUERY_LENGTH = 4;

const mapRow = (row: SearchEntityRow): SuggestEntity => ({
  id: row.id,
  type: row.type as SuggestType,
  refId: row.refId,
  name: row.name,
  subtitle: row.subtitle,
  placeId: row.placeId,
  searchText: row.searchText,
  popularity: row.popularity,
});

export class DrizzleSuggestStore implements SuggestStore {
  constructor(private readonly db: Db) {}

  async findCandidates(normalizedQuery: string, types: readonly SuggestType[], limit: number): Promise<SuggestEntity[]> {
    // normalizedQuery chỉ có [a-z0-9 ] nên không chứa ký tự đại diện của LIKE.
    // Khớp đầu một từ: "ha long" khớp "Hạ Long" nhưng không khớp "Pha Long".
    const isWordStart = sql<boolean>`(' ' || ${searchEntities.searchText}) like ${`% ${normalizedQuery}%`}`;
    const similarity = sql<number>`word_similarity(${normalizedQuery}, ${searchEntities.searchText})`;
    const isMatch =
      normalizedQuery.length < MIN_FUZZY_QUERY_LENGTH ? isWordStart : or(isWordStart, sql`${similarity} >= ${MIN_WORD_SIMILARITY}`);
    const rows = await this.db
      .select()
      .from(searchEntities)
      .where(and(inArray(searchEntities.type, [...types]), isMatch))
      // Cùng mức khớp thì địa điểm trước khách sạn, khách sạn trước sân bay: "hcm" ra TP. Hồ Chí Minh rồi mới tới
      // Tân Sơn Nhất; "da nng" ra Đà Nẵng trước sân bay (chữ tìm của sân bay có thêm mã nên điểm nhỉnh hơn).
      .orderBy(
        desc(isWordStart),
        asc(sql`case ${searchEntities.type} when 'place' then 0 when 'hotel' then 1 else 2 end`),
        desc(similarity),
        desc(searchEntities.popularity),
        asc(searchEntities.name),
      )
      .limit(limit);
    return rows.map(mapRow);
  }

  async replaceAll(entities: readonly SuggestEntity[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(searchEntities);
      if (entities.length > 0) await tx.insert(searchEntities).values([...entities]);
    });
  }
}
