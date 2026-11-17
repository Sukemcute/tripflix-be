import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const RANGE_SECONDS = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 } as const;
export const ObservabilityQuerySchema = z.object({
  range: z.enum(['15m', '1h', '6h', '24h']).default('1h'),
  service: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{1,80}$/)
    .optional(),
});
export const TraceQuerySchema = ObservabilityQuerySchema.extend({
  errorsOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  minDurationMs: z.coerce.number().int().min(0).max(3_600_000).default(0),
});
export type ObservabilityQuery = z.infer<typeof ObservabilityQuerySchema>;
export type TraceQuery = z.infer<typeof TraceQuerySchema>;

export class TelemetrySourceDto {
  @ApiProperty({ enum: ['ready', 'unavailable', 'not_configured'] })
  status!: 'ready' | 'unavailable' | 'not_configured';
}
export class TelemetrySummaryDto {
  @ApiProperty({ type: Number, nullable: true }) requests!: number | null;
  @ApiProperty({ type: Number, nullable: true }) requestRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) errorRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p50Ms!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p95Ms!: number | null;
}
export class TelemetryPointDto {
  @ApiProperty() at!: number;
  @ApiProperty({ type: Number, nullable: true }) requestRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) errorRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p95Ms!: number | null;
}
export class TelemetryServiceDto extends TelemetrySummaryDto {
  @ApiProperty() name!: string;
  @ApiProperty() isHealthy!: boolean;
  @ApiProperty({ type: Number, nullable: true }) lastSeenAt!: number | null;
  @ApiProperty({ type: Number, nullable: true }) memoryBytes!: number | null;
  @ApiProperty({ type: Number, nullable: true }) uptimeSeconds!: number | null;
}
export class TelemetryRouteDto {
  @ApiProperty() service!: string;
  @ApiProperty() method!: string;
  @ApiProperty() route!: string;
  @ApiProperty() requests!: number;
  @ApiProperty({ type: Number, nullable: true }) errorRate!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p95Ms!: number | null;
}
export class ObservabilityDto {
  @ApiProperty() generatedAt!: number;
  @ApiProperty() from!: number;
  @ApiProperty() to!: number;
  @ApiProperty({ type: TelemetrySourceDto }) metricsSource!: TelemetrySourceDto;
  @ApiProperty({ type: TelemetrySummaryDto }) summary!: TelemetrySummaryDto;
  @ApiProperty({ type: [TelemetryPointDto] }) series!: TelemetryPointDto[];
  @ApiProperty({ type: [TelemetryServiceDto] }) services!: TelemetryServiceDto[];
  @ApiProperty({ type: [TelemetryRouteDto] }) routes!: TelemetryRouteDto[];
}
export class TraceSummaryDto {
  @ApiProperty() traceId!: string;
  @ApiProperty() service!: string;
  @ApiProperty() operation!: string;
  @ApiProperty() startedAt!: number;
  @ApiProperty() durationMs!: number;
}
export class TraceListDto {
  @ApiProperty({ type: TelemetrySourceDto }) source!: TelemetrySourceDto;
  @ApiProperty({ type: [TraceSummaryDto] }) traces!: TraceSummaryDto[];
  @ApiProperty() limit!: number;
}
export class TelemetrySpanDto {
  @ApiProperty() spanId!: string;
  @ApiProperty() parentSpanId!: string;
  @ApiProperty() service!: string;
  @ApiProperty() operation!: string;
  @ApiProperty() startedAt!: number;
  @ApiProperty() durationMs!: number;
  @ApiProperty() isError!: boolean;
  @ApiProperty({ type: Number, nullable: true }) httpStatus!: number | null;
}
export class TraceDetailDto {
  @ApiProperty() traceId!: string;
  @ApiProperty({ type: [TelemetrySpanDto] }) spans!: TelemetrySpanDto[];
}
