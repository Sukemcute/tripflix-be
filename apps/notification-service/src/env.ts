import { baseEnvSchema } from '@tripflix/config';
import { z } from 'zod';

const DEV_SMTP_URL = 'smtp://localhost:1025';

export const envSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(3001),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    DATABASE_URL_NOTIFICATION: z.string(),
    // Khoá công khai của module access; service tự kiểm chữ ký access token.
    JWKS_URL: z.url().default('http://localhost:3000/.well-known/jwks.json'),
    AUTH_JWT_ISSUER: z.string().default('tripflix-core'),
    AUTH_JWT_AUDIENCE: z.string().default('tripflix'),
    // Email (out-app): dev đi qua Mailpit, xem ở http://localhost:8025. Production: SMTP của Amazon SES.
    // Chuỗi rỗng (compose.server.yaml khi chưa điền) coi như không đặt.
    SMTP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().default(DEV_SMTP_URL)),
    MAIL_FROM: z.string().default('Tripflix <no-reply@tripflix.local>'),
    // Trang web mở từ nút trong email chào mừng.
    WEB_APP_URL: z.url().default('http://localhost:3100'),
    // Web, admin gọi /notifications từ trình duyệt qua gateway (khác origin): danh sách origin được phép, cách nhau dấu phẩy.
    WEB_ORIGINS: z
      .string()
      .default('http://localhost:3100,http://localhost:3200')
      .transform((v) =>
        v
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    // Tắt khi chạy test không có Redis; mỗi replica một tên để Redis chia việc (mặc định hostname).
    NOTIFICATION_CONSUMER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    NOTIFICATION_CONSUMER_NAME: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    // Giãn nhịp quét để Redis không bị truy vấn liên tục khi SMTP lỗi.
    NOTIFICATION_DLQ_REPLAY_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  })
  .superRefine((env, ctx) => {
    // Production mà vẫn gửi tới Mailpit thì email xác thực, đặt lại mật khẩu không tới người dùng: dừng ngay lúc khởi động.
    if (env.NODE_ENV === 'production' && env.SMTP_URL === DEV_SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'bắt buộc ở production (SMTP của Amazon SES)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
