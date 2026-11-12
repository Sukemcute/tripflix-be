import type { EventEnvelope } from '@tripflix/contracts';

export type EventHandler = (event: EventEnvelope) => Promise<boolean>;
