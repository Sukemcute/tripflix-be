import { z } from 'zod';
import { FEED_SEED_COUNT } from './feed-rank.js';

/** Vị trí trong bảng tin. `at` giữ đủ micro-giây, vì Date của JS chỉ tới mili-giây thì các bài cùng thời điểm sẽ bị rớt khi sang trang. */
export interface FeedCursor {
  at: string;
  id: string;
  /** Chỉ tab Đang hot có điểm, vì tab này xếp theo điểm trước rồi mới tới thứ tự ngẫu nhiên. */
  score?: number;
  /** Seed của thứ tự ngẫu nhiên (feed-rank.ts), chọn ở trang đầu và giữ suốt các trang sau. */
  seed?: number;
  /** Chỉ tab Dành cho bạn: điểm xếp hạng của bài cuối trang trước. */
  rank?: number;
  /** Chỉ tab Dành cho bạn: mốc giờ tính tuổi bài, cố định từ trang đầu để điểm không trôi khi sang trang. */
  asOf?: string;
}

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function isRealTimestamp(at: string): boolean {
  if (!AT_PATTERN.test(at)) return false;
  const time = new Date(at).getTime();
  // So lại để loại ngày không có thật như 31/02, Postgres sẽ báo lỗi nếu nhận phải.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 23) === at.slice(0, 23);
}

const AS_OF_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const feedCursorSchema = z.object({
  at: z.string().refine(isRealTimestamp),
  id: z.guid(),
  score: z.number().int().nonnegative().optional(),
  seed: z.number().int().min(0).max(FEED_SEED_COUNT - 1).optional(),
  rank: z.number().nonnegative().finite().optional(),
  asOf: z
    .string()
    .refine((value) => AS_OF_PATTERN.test(value) && new Date(value).toISOString() === value)
    .optional(),
});

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
