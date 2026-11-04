import { baseEnvSchema } from '@tripflix/config';
import type { ModuleName } from '@tripflix/db';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

export const coreEnvSchema = baseEnvSchema
  .extend({
    APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
    PORT: z.coerce.number().int().positive().default(3000),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    DATABASE_URL_ACCESS: z.string(),
    DATABASE_URL_CONTENT: z.string(),
    DATABASE_URL_DISCOVERY: z.string(),
    DATABASE_URL_ANALYTICS: z.string(),
    DATABASE_URL_COMMERCE: z.string(),
    // Khoá ký access token ES256, PEM PKCS8 (sinh bằng pnpm --filter @tripflix/core-api auth:keygen).
    AUTH_JWT_PRIVATE_KEY: optional,
    AUTH_JWT_KID: optional,
    AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
    AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.AUTH_JWT_PRIVATE_KEY) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_JWT_PRIVATE_KEY'], message: 'bắt buộc ở production' });
    }
  });

export type CoreEnv = z.infer<typeof coreEnvSchema>;

export function dbUrlOf(env: CoreEnv, module: ModuleName): string {
  const key = `DATABASE_URL_${module.toUpperCase()}` as keyof CoreEnv;
  return String(env[key]);
}
