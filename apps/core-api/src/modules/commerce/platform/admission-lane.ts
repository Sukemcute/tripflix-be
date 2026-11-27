import type { AdmittedLane } from './admission-gate.js';

export type CommerceAdmissionLane = AdmittedLane | 'exempt';
export const ADMISSION_LANE = Symbol('COMMERCE_ADMISSION_LANE');
