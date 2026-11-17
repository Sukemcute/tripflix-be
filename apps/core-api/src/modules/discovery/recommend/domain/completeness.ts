import { round4 } from './contracts.js';

export const COMPLETENESS_WEIGHTS = {
  media: 0.25,
  caption: 0.2,
  hashtag: 0.1,
  plan: 0.3,
  tripInfo: 0.15,
} as const;

export interface CompletenessInput {
  mediaIds: string[];
  coverMediaId: string | null;
  body: string;
  hashtags: string[];
  tripAttachment: {
    items?: unknown[];
    daysCount?: number;
    destinationName?: string;
    destinationPlaceId?: string;
    estimatedCostPerPerson?: number;
  } | null;
}

/** Bài có lịch trình khi `tripAttachment.items` không rỗng hoặc `daysCount > 0`. */
export function hasPlan(p: CompletenessInput): boolean {
  const trip = p.tripAttachment;
  if (!trip) return false;
  return (trip.items?.length ?? 0) > 0 || (trip.daysCount ?? 0) > 0;
}

/** Điểm hoàn thiện bài viết trong [0, 1], làm tròn 4 chữ số thập phân. */
export function calculateCompleteness(p: CompletenessInput): number {
  let score = 0;

  if (p.mediaIds.length > 0 || Boolean(p.coverMediaId)) {
    score += COMPLETENESS_WEIGHTS.media;
  }
  if (p.body.trim().length >= 30) {
    score += COMPLETENESS_WEIGHTS.caption;
  }
  if (p.hashtags.length > 0) {
    score += COMPLETENESS_WEIGHTS.hashtag;
  }
  if (hasPlan(p)) {
    score += COMPLETENESS_WEIGHTS.plan;
  }
  const trip = p.tripAttachment;
  if (
    trip &&
    (Boolean(trip.destinationName?.trim()) ||
      Boolean(trip.destinationPlaceId?.trim()) ||
      (trip.daysCount ?? 0) > 0 ||
      (trip.estimatedCostPerPerson ?? 0) > 0)
  ) {
    score += COMPLETENESS_WEIGHTS.tripInfo;
  }

  return round4(Math.min(1, Math.max(0, score)));
}
