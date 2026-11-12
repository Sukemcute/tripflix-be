/**
 * Lỗi do database không phục vụ được (tắt, khởi động lại, hết kết nối trong pool, quá số kết nối),
 * khác với lỗi nghiệp vụ hay lỗi code. Gặp loại này: trang đọc trả bản cũ nếu có, lệnh ghi trả 503 để client thử lại.
 */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);
// SQLSTATE: 08xxx mất kết nối, 53300 quá số kết nối, 57P01–57P03 máy chủ đang tắt / khởi động.
const POSTGRES_CODES = new Set(['08000', '08001', '08003', '08004', '08006', '53300', '57P01', '57P02', '57P03']);
const MESSAGES = ['timeout exceeded when trying to connect', 'Connection terminated', 'connect ECONNREFUSED'];

export function isDatabaseUnavailable(error: unknown): boolean {
  // Drizzle bọc lỗi của pg trong cause; đi vài tầng là đủ.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === 'string' && (NETWORK_CODES.has(code) || POSTGRES_CODES.has(code))) return true;
    if (typeof message === 'string' && MESSAGES.some((m) => message.includes(m))) return true;
    current = cause;
  }
  return false;
}

/** Client nên đợi chừng này giây rồi thử lại (header Retry-After). */
export const RETRY_AFTER_SECONDS = 5;
export const DATABASE_UNAVAILABLE_MESSAGE = 'Hệ thống đang bận hoặc đang bảo trì, vui lòng thử lại sau ít giây.';
