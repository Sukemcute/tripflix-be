import type { ModuleName } from '@tripflix/db';
import type pg from 'pg';

export const CORE_ENV = Symbol('CORE_ENV');
export const DB_POOLS = Symbol('DB_POOLS');
export const REDIS = Symbol('REDIS');

/** Mỗi module một pool riêng; module chỉ được dùng pool của chính mình. */
export type DbPools = Record<ModuleName, pg.Pool>;
