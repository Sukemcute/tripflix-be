/** Lỗi nghiệp vụ của access; tầng api đổi sang mã HTTP. */
export class AccessError extends Error {
  constructor(
    readonly code:
      | 'invalid_credentials'
      | 'too_many_attempts'
      | 'email_taken'
      | 'invalid_refresh'
      | 'session_revoked'
      | 'not_found'
      | 'staff_rule'
      | 'wrong_password'
      | 'invalid_reset_token',
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}
