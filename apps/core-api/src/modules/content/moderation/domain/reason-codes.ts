export const REASON_CODES = [
  'SPAM_OR_COMMERCIAL',
  'SCAM',
  'HARASSMENT',
  'SEXUAL',
  'VIOLENCE',
  'MISINFORMATION',
  'EXTREMISM',
  'OTHER',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
