import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/** 5 module trên database `core`, mỗi module một schema và một user Postgres riêng. */
export const CORE_MODULES = ['access', 'content', 'discovery', 'analytics', 'commerce'] as const;
export const MODULES = CORE_MODULES;
export type ModuleName = (typeof MODULES)[number];

/** Số kết nối gợi ý cho mỗi module (docs/architecture/11 §3.3). */
export const DEFAULT_POOL_SIZE: Record<ModuleName, number> = {
  access: 5,
  content: 10,
  discovery: 5,
  analytics: 3,
  commerce: 10,
};

export interface PoolOptions {
  url: string;
  max: number;
  /** Hiện trong pg_stat_activity, giúp biết kết nối của module nào. */
  applicationName: string;
}

/** Mỗi module một pool, đăng nhập bằng user Postgres chỉ có quyền trên schema của module đó. */
export function createPool({ url, max, applicationName }: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    application_name: applicationName,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
  // Máy chủ cắt một kết nối đang rảnh (khởi động lại DB, tắt container test: 57P01) thì pg phát 'error' trên pool.
  // Không có listener thì Node coi là lỗi không bắt và dừng tiến trình. pg đã tự bỏ client hỏng, query sau mở kết nối mới.
  pool.on('error', (error: Error & { code?: string }) => warnIdleClientError(applicationName, error));
  return pool;
}

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
