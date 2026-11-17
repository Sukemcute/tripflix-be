import { startTelemetry } from '@tripflix/observability';
export const telemetry = startTelemetry('notification-service');
export class TelemetryLifecycle {
  async onApplicationShutdown(): Promise<void> {
    await telemetry?.shutdown();
  }
}
