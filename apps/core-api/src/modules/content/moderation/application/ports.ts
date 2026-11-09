import type { AiVerdict } from '../domain/severity.js';
export interface ModerationItem {
  id: string;
  text: string;
  imageUrls: string[];
}
export interface ModerationAiPort {
  moderate(items: ModerationItem[]): Promise<AiVerdict[] | null>;
}
