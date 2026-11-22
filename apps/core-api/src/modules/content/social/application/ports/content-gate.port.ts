export const CONTENT_GATE_PORT = Symbol('CONTENT_GATE_PORT');

/** Chỉ luật thuần, chạy trước transaction; AI vẫn chạy qua outbox. */
export interface ContentGatePort {
  precheck(text: string): { shouldHold: boolean };
}
