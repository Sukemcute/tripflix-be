import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/** 5 module trên database `core`, mỗi module một schema và một user Postgres riêng. */
export const CORE_MODULES = ['access', 'content', 'discovery', 'analytics', 'commerce'] as const;
export const MODULES = CORE_MODULES;
export type ModuleName = (typeof MODULES)[number];

/** Số kết nối gợi ý cho mỗi module (docs/architecture/11 §3.3). */
export const DEFAULT_POOL_SIZE: Record<ModuleName, number> = {
  // Pool lớn hơn giúp access và discovery tránh xếp hàng quá timeout 3 giây khi chạy nhiều truy vấn song song.
  access: 10,
  content: 10,
  discovery: 12,
  analytics: 3,
  commerce: 10,
};

/**
 * Giới hạn cho pool phục vụ app (L2, rà soát 13/11): không có giới hạn thì một câu chậm bất thường hoặc transaction treo
 * giữ một kết nối và khoá dòng vô thời hạn, vài lần như vậy là pool cạn. Câu dài nhất của job hiện mất ~1,4 giây (đo 16/11).
 * CLI (migrate, seed) không đặt: tạo index, nạp dữ liệu có thể lâu hơn.
 */
export const APP_STATEMENT_TIMEOUT_MS = 10_000;
/** Transaction mở mà không gửi câu nào quá lâu (tiến trình kẹt giữa transaction): Postgres cắt, trả khoá và kết nối. */
export const APP_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export interface PoolOptions {
  url: string;
  max: number;
  /** Hiện trong pg_stat_activity, giúp biết kết nối của module nào. */
  applicationName: string;
  /** Câu lệnh chạy quá lâu thì Postgres huỷ (lỗi 57014). Không đặt thì không giới hạn. */
  statementTimeoutMs?: number;
  /** Transaction đứng yên quá lâu thì Postgres đóng phiên. Không đặt thì không giới hạn. */
  idleInTransactionTimeoutMs?: number;
}

/** Mỗi module một pool, đăng nhập bằng user Postgres chỉ có quyền trên schema của module đó. */
export function createPool({ url, max, applicationName, statementTimeoutMs, idleInTransactionTimeoutMs }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    application_name: applicationName,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    ...(statementTimeoutMs !== undefined && { statement_timeout: statementTimeoutMs }),
    ...(idleInTransactionTimeoutMs !== undefined && { idle_in_transaction_session_timeout: idleInTransactionTimeoutMs }),
  });
  // Máy chủ cắt một kết nối đang rảnh (khởi động lại DB, tắt container test: 57P01) thì pg phát 'error' trên pool.
  // Không có listener thì Node coi là lỗi không bắt và dừng tiến trình. pg đã tự bỏ client hỏng, query sau mở kết nối mới.
  pool.on('error', (error: Error & { code?: string }) => warnIdleClientError(applicationName, error));
  // Client đang được mượn (trong transaction) không có listener của pool. Postgres cắt phiên (idle_in_transaction_session_timeout:
  // 25P03, khởi động lại DB) thì client phát 'error' và tiến trình sập (đo 16/11). Bắt ở đây là đủ: câu tiếp theo của
  // transaction bị từ chối, use case nhận lỗi như mọi lỗi database, pool bỏ client hỏng khi trả về.
  pool.on('connect', (client) => client.on('error', ignoreCheckedOutClientError));
  return pool;
}

/**
 * Đổi số kết nối tối đa của pool lúc đang chạy, kẹp trong [min, max] (tự tăng pool theo tải, Dũng đồng ý 16/11).
 * pg-pool đọc options.max mỗi lần cấp kết nối nên tăng có hiệu lực ngay; request đang xếp hàng được cấp luôn.
 * Giảm thì kết nối rảnh vượt mức tự đóng sau idleTimeoutMillis, kết nối đang dùng không bị cắt. Trả số đã áp dụng.
 */
export function setPoolMax(pool: pg.Pool, requested: number, bounds: { min: number; max: number }): number {
  const next = Math.min(bounds.max, Math.max(bounds.min, Math.floor(requested)));
  if (pool.options.max === next) return next;
  pool.options.max = next;
  // Hàm nội bộ của pg-pool: cấp ngay kết nối mới cho request đang chờ, không đợi tới lượt trả kết nối kế tiếp.
  (pool as unknown as { _pulseQueue?: () => void })._pulseQueue?.();
  return next;
}

/** Lỗi đã được báo cho câu truy vấn đang chạy hoặc câu kế tiếp; listener chỉ để Node không coi là lỗi không bắt. */
function ignoreCheckedOutClientError(): void {}

/** Ghi cảnh báo khi một kết nối rảnh của pool bị lỗi; tách riêng để test được. */
export function warnIdleClientError(applicationName: string, error: Error & { code?: string }): void {
  process.emitWarning(`Kết nối rảnh của pool ${applicationName} bị ngắt (${error.code ?? 'không mã'}): ${error.message}`, { code: 'TRIPFLIX_PG_IDLE_ERROR' });
}

export function createDb(pool: pg.Pool) {
  return drizzle({ client: pool });
}

export type Db = ReturnType<typeof createDb>;

export async function ping(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export * from './transactional.js';
