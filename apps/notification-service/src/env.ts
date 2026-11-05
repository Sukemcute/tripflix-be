import { baseEnvSchema } from '@tripflix/config';
import { z } from 'zod';

export const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL_NOTIFICATION: z.string(),
  // Khoá công khai của module access; service tự kiểm chữ ký access token.
  JWKS_URL: z.url().default('http://localhost:3000/.well-known/jwks.json'),
  AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
  AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
  // Email (out-app): dev đi qua Mailpit, xem ở http://localhost:8025.
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Tripflix <no-reply@tripflix.local>'),
  // Tắt khi chạy test không có Redis; mỗi replica một tên để Redis chia việc (mặc định hostname).
  NOTIFICATION_CONSUMER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  NOTIFICATION_CONSUMER_NAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;
