/** clientId và tên service (aud) dùng cùng dạng: chữ thường, số, gạch nối, 2–50 ký tự, bắt đầu bằng chữ. */
export const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,49}$/;

/** aud của token service mà core-api tự nhận ở các API nội bộ có @ServiceOnly. */
export const CORE_API_SERVICE_AUDIENCE = 'core-api';

export const INVALID_SERVICE_CREDENTIALS_MESSAGE = 'Thông tin service không đúng';

/**
 * Kiểm dữ liệu khi tạo client. aud không được trùng aud của token người dùng (AUTH_JWT_AUDIENCE),
 * nếu không token service có thể lọt vào chỗ chỉ dành cho người dùng. Trả lý do lỗi, hợp lệ thì null.
 */
export function checkServiceClientInput(
  input: { clientId: string; audiences: string[] },
  userAudience: string,
): string | null {
  if (!SERVICE_NAME_PATTERN.test(input.clientId)) return `clientId "${input.clientId}" không hợp lệ: ${SERVICE_NAME_PATTERN}`;
  if (input.audiences.length === 0) return 'Cần ít nhất một service được gọi (audience)';
  for (const audience of input.audiences) {
    if (!SERVICE_NAME_PATTERN.test(audience)) return `audience "${audience}" không hợp lệ: ${SERVICE_NAME_PATTERN}`;
    if (audience === userAudience) return `audience "${audience}" trùng aud của token người dùng`;
  }
  return null;
}

/** Lý do từ chối chỉ ghi vào audit_logs, không trả cho client (mọi trường hợp cùng một thông báo). */
export type ServiceTokenDenial = 'unknown_client' | 'wrong_secret' | 'disabled' | 'audience_not_allowed';
