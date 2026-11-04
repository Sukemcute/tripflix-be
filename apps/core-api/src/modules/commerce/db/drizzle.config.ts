import { defineConfig } from 'drizzle-kit';

// Dùng qua: pnpm db:generate commerce
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/commerce/db/schema/index.ts',
  out: './src/modules/commerce/db/migrations',
  schemaFilter: ['commerce'],
  migrations: { schema: 'commerce', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_COMMERCE ?? '' },
});
