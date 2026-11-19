import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const schema = z.object({
  severity: z.number().int().min(0).max(100),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export function decodeReviewCursor(value?: string) {
  if (!value || /^\d+$/.test(value)) {
    if (value && Number(value) > 1_000_000) throw new BadRequestException('Cursor không hợp lệ');
    return undefined;
  }
  try {
    const parsed = schema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return { ...parsed, time: new Date(parsed.createdAt) };
  } catch {
    throw new BadRequestException('Cursor không hợp lệ');
  }
}
export function encodeReviewCursor(item: { severity: number; id: string; createdAt: Date }) {
  return Buffer.from(
    JSON.stringify({ severity: item.severity, id: item.id, createdAt: item.createdAt.toISOString() }),
  ).toString('base64url');
}
