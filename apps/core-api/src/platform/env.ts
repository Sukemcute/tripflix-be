import { baseEnvSchema } from '@tripflix/config';
import type { ModuleName } from '@tripflix/db';
import { z } from 'zod';

export const coreEnvSchema = baseEnvSchema.extend({
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL_ACCESS: z.string(),
  DATABASE_URL_CONTENT: z.string(),
  DATABASE_URL_DISCOVERY: z.string(),
  DATABASE_URL_ANALYTICS: z.string(),
  DATABASE_URL_COMMERCE: z.string(),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

export function dbUrlOf(env: CoreEnv, module: ModuleName): string {
  const key = `DATABASE_URL_${module.toUpperCase()}` as keyof CoreEnv;
  return String(env[key]);
}
