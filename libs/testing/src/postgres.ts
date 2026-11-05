import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ModuleName } from '@tripflix/db';

/** Cùng image với deploy/compose.yaml, để test chạy đúng bản Postgres và extension (pgvector) của môi trường thật. */
export const POSTGRES_IMAGE = 'pgvector/pgvector:pg17';

// src/ hoặc dist/ của libs/testing → <repo>/deploy/postgres/init/
const INIT_SCRIPTS_DIR = fileURLToPath(new URL('../../../deploy/postgres/init/', import.meta.url));

export type DatabaseUser = ModuleName | 'notification';

export interface PostgresFixture {
  container: StartedPostgreSqlContainer;
  /** Kết nối superuser postgres tới database chỉ định; chỉ dùng để chuẩn bị hoặc kiểm dữ liệu trong test. */
  buildAdminUrl(database: 'core' | 'notification'): string;
  /** Kết nối bằng user của module (tf_<module>), chỉ có quyền trên schema của module đó. */
  buildModuleUrl(module: DatabaseUser): string;
  stop(): Promise<void>;
}

const databaseOf = (module: DatabaseUser) => (module === 'notification' ? 'notification' : 'core');

/**
 * Bật Postgres thật trong Docker và chạy deploy/postgres/init/*.sql: 2 database (`core` gồm 5 schema module, `notification`), user và schema theo module,
 * extension. Mật khẩu user module giống bản dev (tf_<module>_dev).
 */
export async function startPostgres(): Promise<PostgresFixture> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withDatabase('postgres')
    .withCopyDirectoriesToContainer([{ source: INIT_SCRIPTS_DIR, target: '/docker-entrypoint-initdb.d' }])
    .start();
  const host = container.getHost();
  const port = container.getPort();
  return {
    container,
    buildAdminUrl: (database) => `postgres://postgres:postgres@${host}:${port}/${database}`,
    buildModuleUrl: (module) => `postgres://tf_${module}:tf_${module}_dev@${host}:${port}/${databaseOf(module)}`,
    stop: async () => {
      await container.stop();
    },
  };
}
