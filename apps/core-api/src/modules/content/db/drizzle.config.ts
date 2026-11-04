import { defineConfig } from 'drizzle-kit';

// Dùng qua: pnpm db:generate content
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/content/db/schema/index.ts',
  out: './src/modules/content/db/migrations',
  schemaFilter: ['content'],
  migrations: { schema: 'content', table: '__migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_CONTENT ?? '' },
});
