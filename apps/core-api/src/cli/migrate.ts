import '../platform/load-env.js';
import { existsSync } from 'node:fs';
import { loadEnv } from '@tripflix/config';
import { MODULES, createDb, createPool } from '@tripflix/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { coreEnvSchema, dbUrlOf } from '../platform/env.js';

// Chạy migration của từng module bằng user Postgres của chính module đó.
// Bảng lịch sử migration nằm trong schema của module: <module>.__migrations.
const env = loadEnv(coreEnvSchema);

for (const module of MODULES) {
  const folder = `src/modules/${module}/db/migrations`;
  if (!existsSync(folder)) {
    process.stdout.write(`${module}: chưa có migration\n`);
    continue;
  }
  const pool = createPool({ url: dbUrlOf(env, module), max: 1, applicationName: `migrate:${module}` });
  try {
    await migrate(createDb(pool), {
      migrationsFolder: folder,
      migrationsSchema: module,
      migrationsTable: '__migrations',
    });
    process.stdout.write(`${module}: đã migrate\n`);
  } finally {
    await pool.end();
  }
}
