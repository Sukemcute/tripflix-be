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
 * pool.end() trả về trước khi socket đóng hẳn. Tắt Postgres lúc đó thì client đang đóng nhận FATAL 57P01
 * mà không có handler, CI báo lỗi unhandled dù test pass. Đợi tối đa ~3 giây cho mọi kết nối của test đóng xong.
 */
async function waitForClientsClosed(container: StartedPostgreSqlContainer): Promise<void> {
  const countClients =
    "SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { output, exitCode } = await container.exec(['psql', '-U', 'postgres', '-tAc', countClients]);
    if (exitCode !== 0 || output.trim() === '0') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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
      await waitForClientsClosed(container);
      await container.stop();
    },
  };
}
