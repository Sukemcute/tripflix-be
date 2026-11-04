import { defineConfig } from 'drizzle-kit';

// Dùng qua: pnpm db:generate access
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/access/db/schema/index.ts',
  out: './src/modules/access/db/migrations',
  schemaFilter: ['access'],
  migrations: { schema: 'access', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_ACCESS ?? '' },
});
