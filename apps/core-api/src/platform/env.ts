import { baseEnvSchema } from '@tripflix/config';
import type { ModuleName } from '@tripflix/db';
import { z } from 'zod';

const OptionalStringSchema = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

/** Origin của web và admin khi dev (deploy/compose.yaml: web 3100, admin 3200). */
export const DEFAULT_WEB_ORIGINS = ['http://localhost:3100', 'http://localhost:3200'];

/** Đúng dạng origin trình duyệt gửi: http(s)://host[:port], không có đường dẫn hay dấu / cuối. */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

// Danh sách cách nhau bởi dấu phẩy, ví dụ https://tripflix.vn,https://admin.tripflix.vn.
const WebOriginsSchema = z
  .string()
  .default(DEFAULT_WEB_ORIGINS.join(','))
  .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean))
  .pipe(z.array(z.string().refine(isOrigin, 'phải là origin dạng http(s)://host[:port], không có đường dẫn hay dấu / cuối')));

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
    AUTH_JWT_PRIVATE_KEY: OptionalStringSchema,
    AUTH_JWT_KID: OptionalStringSchema,
    AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
    AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
    // Web, admin được gọi API từ trình duyệt (CORS) và dùng cookie refresh token (chặn CSRF theo Origin).
    AUTH_WEB_ORIGINS: WebOriginsSchema,
    // Media trên S3. Có giá trị mặc định để máy chưa cấu hình AWS vẫn khởi động được; key AWS do SDK tự đọc.
    AWS_REGION: z.string().default('ap-southeast-2'),
    S3_MEDIA_BUCKET: z.string().default('tripflix-media-dev'),
    S3_KEY_PREFIX: z.string().default('dev/unknown/'),
    MEDIA_CDN_URL: OptionalStringSchema,
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
