/** Lỗi nghiệp vụ của commerce; tầng api (hoặc module gọi facade) đổi sang mã HTTP. */
export class CommerceError extends Error {
  constructor(
    readonly code: 'invalid_query' | 'not_found',
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'CommerceError';
  }
}
