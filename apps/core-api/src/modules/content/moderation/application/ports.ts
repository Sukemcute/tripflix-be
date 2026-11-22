import type { AiVerdict } from '../domain/severity.js';
import type { PartVerdict } from '../../db/schema/moderation-parts.js';
export interface ModerationPartInput {
  id: string;
  kind: 'caption' | 'image';
  text?: string;
  imageUrl?: string;
}
export interface ModerationItem {
  id: string;
  text: string;
  imageUrls: string[];
}
export interface ModerationAiPort {
  moderate(items: ModerationItem[]): Promise<AiVerdict[] | null>;
  moderateParts?(items: ModerationPartInput[]): Promise<PartVerdict[] | null>;
  ocrVideoCover?(id: string, jpeg: Buffer): Promise<PartVerdict | null>;
}
