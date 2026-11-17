import { z } from 'zod';

const HttpUrlSchema = z.url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const OptionalUrlSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  HttpUrlSchema.optional(),
);
export const TelemetryEnvSchema = z.object({
  ANALYTICS_PROMETHEUS_URL: OptionalUrlSchema,
  ANALYTICS_TEMPO_URL: OptionalUrlSchema,
});
export type TelemetryEnv = z.infer<typeof TelemetryEnvSchema>;

export const PrometheusResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    resultType: z.enum(['vector', 'matrix']),
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()),
        value: z.tuple([z.number(), z.string()]).optional(),
        values: z.array(z.tuple([z.number(), z.string()])).optional(),
      }),
    ),
  }),
});
export type PrometheusSample = z.infer<typeof PrometheusResponseSchema>['data']['result'][number];

/** URLs only come from server configuration; callers cannot supply hosts or arbitrary queries. */
export async function readTelemetryJson(
  base: string,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${base.replace(/\/$/, '')}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`);
  // Bound memory even for upstream responses without Content-Length.
  if (!response.body) throw new Error('Telemetry response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024) throw new Error('Telemetry response too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function finiteValue(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
