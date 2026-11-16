import type { ContentGatePort } from '../../social/application/ports/content-gate.port.js';
import { evaluateRules } from '../domain/rules.js';
import { evaluateSeverity } from '../domain/severity.js';

export class RulesContentGate implements ContentGatePort {
  precheck(text: string): { shouldHold: boolean } {
    const rules = evaluateRules(text).filter((hit) => ['SCAM_PATTERN', 'THREAT'].includes(hit.code));
    return {
      shouldHold: evaluateSeverity(rules, null, 0, { aiThreshold: 0.8, reportThreshold: 3 }).shouldAutoHide,
    };
  }
}
