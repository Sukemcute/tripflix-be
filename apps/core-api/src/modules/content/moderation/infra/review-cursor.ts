import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const schema = z.object({
  severity: z.number().int().min(0).max(100),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  sort: z.enum(['priority', 'newest']).optional(),
  sortAt: z.iso.datetime().optional(),
});
export function decodeReviewCursor(value?: string, expectedSort: 'priority' | 'newest' = 'priority') {
  if (!value || /^\d+$/.test(value)) {
    if (value && Number(value) > 1_000_000) throw new BadRequestException('Cursor không hợp lệ');
    return undefined;
  }
  try {
    const parsed = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    const sort = parsed.sort ?? 'priority';
    if (sort !== expectedSort || (sort === 'newest' && !parsed.sortAt)) throw new Error('Cursor sort mismatch');
    return { ...parsed, sort, time: new Date(sort === 'newest' ? parsed.sortAt! : parsed.createdAt) };
  } catch {
    throw new BadRequestException('Cursor không hợp lệ');
  }
}
export function encodeReviewCursor(
  item: { severity: number; id: string; createdAt: Date; sortAt?: Date | string },
  sort: 'priority' | 'newest' = 'priority',
) {
  return Buffer.from(
    JSON.stringify({
      severity: item.severity,
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      ...(sort === 'newest'
        ? { sort, sortAt: new Date(item.sortAt!).toISOString() }
        : {}),
    }),
  ).toString('base64url');
}
