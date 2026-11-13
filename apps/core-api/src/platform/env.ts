import { baseEnvSchema } from '@tripflix/config';
import type { ModuleName } from '@tripflix/db';
import { z } from 'zod';

const OptionalStringSchema = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

/** Trang đặt lại mật khẩu của web (Thành); link trong email là địa chỉ này kèm ?token=... */
export const DEFAULT_PASSWORD_RESET_URL = 'http://localhost:3100/dat-lai-mat-khau';

/** Trang xác thực email của web (TF05D); link trong email là địa chỉ này kèm ?token=... */
export const DEFAULT_EMAIL_VERIFY_URL = 'http://localhost:3100/xac-thuc-email';

/** Khoá công khai của Google để kiểm ID token (POST /auth/google). */
export const DEFAULT_GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Web khi dev (deploy/compose.yaml: web 3100); trùng mặc định WEB_APP_URL của notification-service. */
export const DEFAULT_WEB_APP_URL = 'http://localhost:3100';

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
  .transform((v) =>
    v
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z
        .string()
        .refine(isOrigin, 'phải là origin dạng http(s)://host[:port], không có đường dẫn hay dấu / cuối'),
    ),
  );

// Khoá công khai ES256 của khoá đã nghỉ; có `d` là dán nhầm khoá riêng nên từ chối.
const PublicEcJwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().min(1),
  y: z.string().min(1),
  kid: z.string().min(1),
  d: z.never({ error: 'chỉ dán khoá công khai, không dán khoá riêng' }).optional(),
});

// Dán nguyên kết quả GET /.well-known/jwks.json trước khi đổi khoá (README của module access).
const PreviousJwksSchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'phải là JSON dạng { "keys": [...] }' });
        return z.NEVER;
      }
    })
    .pipe(z.object({ keys: z.array(PublicEcJwkSchema).min(1) }))
    .optional(),
);

export const coreEnvSchema = baseEnvSchema
  .extend({
    APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
    PORT: z.coerce.number().int().positive().default(3000),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AI_SERVICE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
    CORE_API_INTERNAL_URL: z.url().default('http://localhost:3000'),
    MODERATION_SERVICE_CLIENT_SECRET: OptionalStringSchema,
    MODERATION_AI_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
    MODERATION_REPORT_THRESHOLD: z.coerce.number().int().min(1).default(3),
    MODERATION_ALLOWED_DOMAINS: z.string().default('tripflix.vn,maps.google.com,maps.app.goo.gl'),
    DATABASE_URL_ACCESS: z.string(),
    DATABASE_URL_CONTENT: z.string(),
    DATABASE_URL_DISCOVERY: z.string(),
    DATABASE_URL_ANALYTICS: z.string(),
    DATABASE_URL_COMMERCE: z.string(),
    // Khoá ký access token ES256, PEM PKCS8 (sinh bằng pnpm --filter @tripflix/core-api auth:keygen).
    AUTH_JWT_PRIVATE_KEY: OptionalStringSchema,
    AUTH_JWT_KID: OptionalStringSchema,
    AUTH_JWT_PREVIOUS_JWKS: PreviousJwksSchema,
    AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
    AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
    // Web, admin được gọi API từ trình duyệt (CORS) và dùng cookie refresh token (chặn CSRF theo Origin).
    AUTH_WEB_ORIGINS: WebOriginsSchema,
    AUTH_PASSWORD_RESET_URL: z.url().default(DEFAULT_PASSWORD_RESET_URL),
    AUTH_EMAIL_VERIFY_URL: z.url().default(DEFAULT_EMAIL_VERIFY_URL),
    // Địa chỉ web người dùng mở (không có / cuối); dùng cho link chia sẻ bài. Cùng tên với notification-service.
    WEB_APP_URL: z.url().default(DEFAULT_WEB_APP_URL),
    // Số tài khoản đăng ký bằng mật khẩu mỗi IP mỗi giờ (TF05D). Máy dev, CI chạy e2e đăng ký nhiều lần thì đặt cao hơn.
    AUTH_REGISTER_MAX_PER_IP_HOUR: z.coerce.number().int().positive().default(5),
    // Khoá X25519 để client mã hoá mật khẩu trước khi gửi (TF056): "<keyId>:<khoá>,<keyId cũ>:<khoá cũ>", khoá đầu đang dùng.
    // Sinh bằng pnpm --filter @tripflix/core-api auth:password-keygen. Dev bỏ trống: dùng khoá tạm.
    AUTH_PASSWORD_KEYS: OptionalStringSchema,
    // true: từ chối mật khẩu gửi thường. Chỉ bật khi web, admin, mobile đều đã gửi mật khẩu mã hoá.
    AUTH_PASSWORD_ENCRYPTION_REQUIRED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // OAuth Client ID (Android, iOS, Web) tạo trên Google Cloud Console, cách nhau bởi dấu phẩy. Trống: tắt đăng nhập Google.
    GOOGLE_CLIENT_IDS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    GOOGLE_JWKS_URL: z.url().default(DEFAULT_GOOGLE_JWKS_URL),
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
    // Bắt buộc mã hoá mà không có khoá thì không ai đăng nhập được: dừng ngay lúc khởi động.
    // Production chưa bắt buộc mà thiếu khoá: vẫn chạy, tắt mã hoá (log lỗi), để lần deploy chưa kịp đặt khoá không làm sập server.
    if (env.AUTH_PASSWORD_ENCRYPTION_REQUIRED && !env.AUTH_PASSWORD_KEYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_PASSWORD_KEYS'],
        message: 'bắt buộc khi AUTH_PASSWORD_ENCRYPTION_REQUIRED=true',
      });
    }
  });

export type CoreEnv = z.infer<typeof coreEnvSchema>;

export function dbUrlOf(env: CoreEnv, module: ModuleName): string {
  const key = `DATABASE_URL_${module.toUpperCase()}` as Extract<keyof CoreEnv, `DATABASE_URL_${string}`>;
  return String(env[key]);
}
