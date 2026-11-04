import { defineConfig } from 'drizzle-kit';

// Dùng qua: pnpm db:generate analytics
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/analytics/db/schema/index.ts',
  out: './src/modules/analytics/db/migrations',
  schemaFilter: ['analytics'],
  migrations: { schema: 'analytics', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_ANALYTICS ?? '' },
});
