import { z } from 'zod';

/** Vị trí trong bảng tin. `at` giữ đủ micro-giây, vì Date của JS chỉ tới mili-giây thì các bài cùng thời điểm sẽ bị rớt khi sang trang. */
export interface FeedCursor {
  at: string;
  id: string;
}

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function isRealTimestamp(at: string): boolean {
  if (!AT_PATTERN.test(at)) return false;
  const time = new Date(at).getTime();
  // So lại để loại ngày không có thật như 31/02, Postgres sẽ báo lỗi nếu nhận phải.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 23) === at.slice(0, 23);
}

const feedCursorSchema = z.object({ at: z.string().refine(isRealTimestamp), id: z.guid() });

export function encodeFeedCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Trả null khi cursor không hợp lệ. */
export function decodeFeedCursor(value: string): FeedCursor | null {
  try {
    const parsed = feedCursorSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
