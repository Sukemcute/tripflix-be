import { loadEnv } from '@tripflix/config';
import { envSchema } from './env.js';

const base = { DATABASE_URL_NOTIFICATION: 'postgres://x' };

describe('TF05D: env notification-service', () => {
  it('chu kỳ replay mặc định một phút và chỉ nhận số nguyên dương', () => {
    expect(loadEnv(envSchema, base).NOTIFICATION_DLQ_REPLAY_INTERVAL_MS).toBe(60_000);
    expect(loadEnv(envSchema, { ...base, NOTIFICATION_DLQ_REPLAY_INTERVAL_MS: '120000' }).NOTIFICATION_DLQ_REPLAY_INTERVAL_MS).toBe(120_000);
    for (const interval of ['0', '-1', '1.5', 'invalid']) {
      expect(() => loadEnv(envSchema, { ...base, NOTIFICATION_DLQ_REPLAY_INTERVAL_MS: interval })).toThrow();
    }
  });

  it('dev: không đặt hoặc để trống SMTP_URL thì gửi qua Mailpit', () => {
    expect(loadEnv(envSchema, base).SMTP_URL).toBe('smtp://localhost:1025');
    expect(loadEnv(envSchema, { ...base, SMTP_URL: '' }).SMTP_URL).toBe('smtp://localhost:1025');
  });

  it('production thiếu SMTP_URL (hoặc để trống như compose.server.yaml chưa điền): dừng lúc khởi động', () => {
    expect(() => loadEnv(envSchema, { ...base, NODE_ENV: 'production' })).toThrow(/SMTP_URL/);
    expect(() => loadEnv(envSchema, { ...base, NODE_ENV: 'production', SMTP_URL: '' })).toThrow(/SMTP_URL/);
  });

  it('production có SMTP của SES thì chạy', () => {
    const env = loadEnv(envSchema, {
      ...base,
      NODE_ENV: 'production',
      SMTP_URL: 'smtps://AKIA:secret@email-smtp.ap-southeast-1.amazonaws.com:465',
    });
    expect(env.SMTP_URL).toContain('amazonaws.com');
  });
});
