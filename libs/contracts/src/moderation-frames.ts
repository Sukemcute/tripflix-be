import { z } from 'zod';

export const FRAME_POLICY = 'uniform-v1';
export const MAX_MODERATION_FRAMES = 24;
export const MAX_MODERATION_DURATION_MS = 300_000;
export function sampleFrameTimes(durationMs: number): number[] {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_MODERATION_DURATION_MS)
    throw new Error('Thời lượng video ngoài phạm vi kiểm duyệt');
  const last = Math.max(0, durationMs - Math.max(1, Math.min(100, Math.floor(durationMs / 2))));
  const count = Math.min(MAX_MODERATION_FRAMES, Math.ceil(last / 5_000) + 1);
  return count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round(last * i / (count - 1)));
}
export const MediaFramesRequestedV1Schema = z.object({
  assetId: z.uuid(), requestId: z.uuid(), sourceKey: z.string().min(1).max(2048),
  hlsPrefix: z.string().min(1).max(1024), policy: z.literal(FRAME_POLICY),
});
export type MediaFramesRequestedV1 = z.infer<typeof MediaFramesRequestedV1Schema>;
export const ModerationFrameSchema = z.object({ timestampMs: z.int().min(0).max(MAX_MODERATION_DURATION_MS), key: z.string().min(1).max(2048) });
export const MediaFramesCompletedV1Schema = z.object({
  assetId: z.uuid(), requestId: z.uuid(), hlsPrefix: z.string().min(1).max(1024), policy: z.literal(FRAME_POLICY),
  durationMs: z.int().positive().max(MAX_MODERATION_DURATION_MS),
  frames: z.array(ModerationFrameSchema).min(1).max(MAX_MODERATION_FRAMES),
}).superRefine((value, ctx) => {
  const expected = sampleFrameTimes(value.durationMs);
  if (value.frames.length !== expected.length || value.frames.some((f, i) => f.timestampMs !== expected[i] ||
    f.key !== `${value.hlsPrefix}/moderation/${FRAME_POLICY}/${value.requestId}/${f.timestampMs}.jpg`))
    ctx.addIssue({ code: 'custom', message: 'Manifest phải chứa đủ frame đúng policy và key của lượt xử lý' });
});
export type MediaFramesCompletedV1 = z.infer<typeof MediaFramesCompletedV1Schema>;
export const MediaFramesFailedV1Schema = z.object({
  assetId: z.uuid(), requestId: z.uuid(), errorCode: z.enum(['extraction_failed', 'video_too_long', 'source_too_large']),
});
