import { and, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

export interface KeysetCursor {
  time: Date;
  id: string;
}

/**
 * Mốc thời gian của cursor đủ micro giây. Cursor chỉ giữ mili giây (Date của JS), Postgres lưu micro giây:
 * so thẳng với mốc mili giây thì bỏ sót các dòng khác cùng mili giây với dòng cuối trang.
 * Lấy lại thời gian của chính dòng cursor trong DB; dòng không còn, hoặc thời gian đã đổi (bài vừa sửa),
 * thì dùng mốc trong cursor như trước để không nhảy cóc.
 */
function cursorTime(table: PgTable, timeColumn: PgColumn, idColumn: PgColumn, cursor: KeysetCursor): SQL {
  const time = sql.identifier(timeColumn.name);
  return sql`coalesce((
    SELECT CASE WHEN date_trunc('milliseconds', cursor_row.${time}) = ${cursor.time} THEN cursor_row.${time} END
    FROM ${table} AS cursor_row WHERE cursor_row.${sql.identifier(idColumn.name)} = ${cursor.id}
  ), ${cursor.time})`;
}

/** Dòng nằm sau cursor khi sắp (thời gian giảm dần, id giảm dần). */
export function isBeforeCursor(table: PgTable, timeColumn: PgColumn, idColumn: PgColumn, cursor: KeysetCursor): SQL {
  const time = cursorTime(table, timeColumn, idColumn, cursor);
  return or(lt(timeColumn, time), and(eq(timeColumn, time), lt(idColumn, cursor.id)))!;
}

/** Dòng nằm sau cursor khi sắp (thời gian tăng dần, id tăng dần). */
export function isAfterCursor(table: PgTable, timeColumn: PgColumn, idColumn: PgColumn, cursor: KeysetCursor): SQL {
  const time = cursorTime(table, timeColumn, idColumn, cursor);
  return or(gt(timeColumn, time), and(eq(timeColumn, time), gt(idColumn, cursor.id)))!;
}
