/** Initial operational SLA; a lease never extends the review deadline. */
export const REVIEW_LEASE_MINUTES = 15;
export const URGENT_REVIEW_HOURS = 1;
export const STANDARD_REVIEW_HOURS = 24;
export function reviewDueAt(createdAt: Date, severity: number): Date {
  return new Date(
    createdAt.getTime() + (severity >= 80 ? URGENT_REVIEW_HOURS : STANDARD_REVIEW_HOURS) * 3_600_000,
  );
}
