/** Lỗi nghiệp vụ của commerce; tầng api (hoặc module gọi facade) đổi sang mã HTTP. */
export class CommerceError extends Error {
  constructor(
    readonly code: 'invalid_query' | 'not_found' | 'conflict' | 'gone' | 'rate_limited' | 'payment_failed',
    message: string,
    readonly field?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}
