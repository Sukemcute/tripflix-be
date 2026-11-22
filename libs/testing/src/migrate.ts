import { createDb, createPool, type ModuleName } from '@tripflix/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

/**
 * Chạy migration của một module bằng user Postgres của module đó, giống `pnpm db:migrate`
 * (bảng lịch sử <module>.__migrations). `migrationsFolder` là đường dẫn tuyệt đối tới db/migrations.
 */
export async function migrateModule(options: { url: string; module: ModuleName; migrationsFolder: string }): Promise<void> {
  const pool = createPool({ url: options.url, max: 1, applicationName: `test-migrate:${options.module}` });
  try {
    await migrate(createDb(pool), {
      migrationsFolder: options.migrationsFolder,
      migrationsSchema: options.module,
      migrationsTable: '__migrations',
    });
  } finally {
    await pool.end();
  }
}
