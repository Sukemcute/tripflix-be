import { z } from 'zod';

/** Biến môi trường dùng chung cho mọi app. App nào cần thêm thì .extend(). */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/**
 * Đọc và kiểm biến môi trường theo schema zod.
 * Thiếu hoặc sai kiểu thì ném lỗi liệt kê đủ các biến, để app dừng ngay khi khởi động.
 */
export function loadEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, unknown> = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.') || '(gốc)'}: ${i.message}`);
    throw new Error(`Biến môi trường thiếu hoặc sai:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
