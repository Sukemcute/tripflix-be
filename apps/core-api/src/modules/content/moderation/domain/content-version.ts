import { createHash } from 'node:crypto';

export const MODERATION_POLICY_VERSION = 'tripflix-community-v1';
export const APPEAL_WINDOW_DAYS = 30;
export const EVIDENCE_RETENTION_DAYS = 90;

/** Chỉ thay đổi khi đầu vào cần kiểm duyệt thay đổi, không phụ thuộc counter/visibility. */
export function contentVersion(
  text: string,
  coverMediaId: string | null,
  mediaIds: readonly string[] = [],
): string {
  return `v1:${createHash('sha256')
    .update(JSON.stringify([text, coverMediaId, mediaIds]))
    .digest('hex')}`;
}

export function postEvidence(post: {
  title: string;
  body: string;
  hashtags: string[];
  coverMediaId: string | null;
  mediaIds: string[];
}) {
  return {
    text: [post.title, post.body, ...post.hashtags].join('\n'),
    coverMediaId: post.coverMediaId,
    mediaIds: post.mediaIds,
  };
}
