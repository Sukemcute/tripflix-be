import { z } from 'zod';

export const COMMERCE_ADMISSION_CONFIG = Symbol('COMMERCE_ADMISSION_CONFIG');

const AdmissionEnvSchema = z.object({
  COMMERCE_ADMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  COMMERCE_ADMIT_TOTAL: z.coerce.number().int().positive().default(80),
  COMMERCE_ADMIT_TX_RESERVED: z.coerce.number().int().nonnegative().default(20),
  COMMERCE_ADMIT_TX_QUEUE_MAX: z.coerce.number().int().nonnegative().default(50),
  COMMERCE_ADMIT_TX_WAIT_MS: z.coerce.number().int().nonnegative().max(2_147_483_647).default(2000),
}).refine((env) => env.COMMERCE_ADMIT_TX_RESERVED < env.COMMERCE_ADMIT_TOTAL, {
  path: ['COMMERCE_ADMIT_TX_RESERVED'],
  message: 'Số suất dành riêng cho giao dịch phải nhỏ hơn tổng số suất.',
}).transform((env) => ({
  isEnabled: env.COMMERCE_ADMIT_ENABLED === 'true',
  total: env.COMMERCE_ADMIT_TOTAL,
  txReserved: env.COMMERCE_ADMIT_TX_RESERVED,
  txQueueMax: env.COMMERCE_ADMIT_TX_QUEUE_MAX,
  txWaitMs: env.COMMERCE_ADMIT_TX_WAIT_MS,
}));

export type AdmissionConfig = z.infer<typeof AdmissionEnvSchema>;

export function loadAdmissionConfig(source: Record<string, unknown>): AdmissionConfig {
  return AdmissionEnvSchema.parse(source);
}
