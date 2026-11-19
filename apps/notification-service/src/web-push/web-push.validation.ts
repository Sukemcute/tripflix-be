import { z } from 'zod';

export function isPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      (hosts.includes(url.hostname) ||
        url.hostname.endsWith('.push.apple.com') ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
const key = (length: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/)
    .max(180)
    .refine((value) => Buffer.from(value, 'base64url').length === length);
export const SubscriptionSchema = z
  .object({
    endpoint: z.string().max(2048).refine(isPushEndpoint),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({ p256dh: key(65).refine((value) => Buffer.from(value, 'base64url')[0] === 4), auth: key(16) })
      .strict(),
  })
  .strict();

export function webNotificationHref(
  row: { type: string; link: string | null; data: Record<string, unknown> },
  origin: string,
): string {
  const { orderId, postId, commentId } = row.data;
  if (typeof orderId === 'string' && orderId.length <= 128) return `/checkout/${encodeURIComponent(orderId)}`;
  if (typeof postId === 'string' && postId.length <= 128 && row.type.startsWith('comment.')) {
    const query = new URLSearchParams({ open: postId });
    if (typeof commentId === 'string' && commentId.length <= 128) query.set('comment', commentId);
    return `/inspiration?${query}`;
  }
  try {
    if (row.link && row.link.length > 2048) return '/';
    const url = new URL(row.link ?? '/', origin);
    const href = url.pathname + url.search + url.hash;
    return url.origin === new URL(origin).origin && href.length <= 512 ? href : '/';
  } catch {
    return '/';
  }
}

export const RemoveSubscriptionSchema = z
  .object({ endpoint: z.string().max(2048).refine(isPushEndpoint) })
  .strict();
export const WebPushConfigurationSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().nullable(),
});
export const WebPushRegistrationSchema = z.object({ id: z.uuid(), userId: z.uuid() });

/** Payload push có giới hạn 4 KiB: chỉ mang id định tuyến, không mang mọi metadata inbox. */
export function webPushData(data: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const name of ['postId', 'commentId', 'parentCommentId', 'orderId']) {
    const value = data[name];
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) safe[name] = value;
  }
  const actor = Array.isArray(data.actorIds) ? (data.actorIds.at(-1) as unknown) : null;
  if (typeof actor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(actor)) safe.actorIds = [actor];
  return safe;
}
