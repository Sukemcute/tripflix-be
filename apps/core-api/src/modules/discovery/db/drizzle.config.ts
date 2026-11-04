import { defineConfig } from 'drizzle-kit';

// Dùng qua: pnpm db:generate discovery
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/discovery/db/schema/index.ts',
  out: './src/modules/discovery/db/migrations',
  schemaFilter: ['discovery'],
  migrations: { schema: 'discovery', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_DISCOVERY ?? '' },
});
