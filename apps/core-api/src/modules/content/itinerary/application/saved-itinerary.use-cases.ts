import type { SavedItineraryRecord, TripAttachmentData } from '../../db/schema/index.js';
import {
  EmptyItineraryError,
  fromBuilder,
  fromReel,
  fromTripi,
  MAX_ITINERARY_DAYS,
  type BuilderTrip,
  type SavedItineraryDraft,
  type SavedItineraryItem,
  type TripiTrip,
} from '../domain/saved-itinerary.js';

export interface ReelForItinerary {
  id: string;
  title: string;
  authorId: string;
  status: string;
  visibility: string;
  tripAttachment: TripAttachmentData | null;
}

export interface SavedItineraryChanges {
  title?: string;
  daysCount?: number;
  items?: SavedItineraryItem[];
}

export interface SavedItineraryStore {
  listOfUser(userId: string, options: { sourcePostId?: string; limit: number }): Promise<SavedItineraryRecord[]>;
  findOfUser(userId: string, id: string): Promise<SavedItineraryRecord | null>;
  insert(userId: string, draft: SavedItineraryDraft): Promise<SavedItineraryRecord>;
  update(userId: string, id: string, changes: SavedItineraryChanges): Promise<SavedItineraryRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  findReel(postId: string): Promise<ReelForItinerary | null>;
}

export const SAVED_ITINERARY_STORE = Symbol('SAVED_ITINERARY_STORE');

export type SaveItineraryInput =
  | { source: 'reel'; postId: string }
  | { source: 'tripi'; title?: string; trip: TripiTrip }
  | { source: 'builder'; title?: string; builder: BuilderTrip };

export class SavedItineraryNotFoundError extends Error {
  constructor() {
    super('Không tìm thấy lộ trình.');
  }
}
export { EmptyItineraryError };

const LIST_LIMIT = 100;

/** Lưu, xem, sửa, xoá lộ trình của chính người gọi (TF105). Đổi dữ liệu từng nguồn ở đây để web và app dùng chung. */
export class SavedItineraryUseCases {
  constructor(private readonly store: SavedItineraryStore) {}

  list(userId: string, options: { sourcePostId?: string } = {}) {
    return this.store.listOfUser(userId, { ...options, limit: LIST_LIMIT });
  }

  async get(userId: string, id: string) {
    const row = await this.store.findOfUser(userId, id);
    if (!row) throw new SavedItineraryNotFoundError();
    return row;
  }

  async save(userId: string, input: SaveItineraryInput) {
    if (input.source === 'reel') {
      const reel = await this.store.findReel(input.postId);
      // Reel chưa đăng hoặc riêng tư của người khác coi như không có, không lộ là có.
      const canRead = reel && (reel.authorId === userId || (reel.status === 'published' && reel.visibility === 'public'));
      if (!canRead) throw new SavedItineraryNotFoundError();
      return this.store.insert(userId, fromReel(reel));
    }
    const draft = input.source === 'tripi' ? fromTripi(input.trip, input.title) : fromBuilder(input.builder, input.title);
    return this.store.insert(userId, draft);
  }

  async update(userId: string, id: string, changes: SavedItineraryChanges) {
    if (changes.items && !changes.items.some((i) => i.title.trim())) throw new EmptyItineraryError();
    const lastDay = changes.items ? Math.max(...changes.items.map((i) => i.day)) : 0;
    const daysCount = changes.daysCount !== undefined || changes.items ? Math.min(MAX_ITINERARY_DAYS, Math.max(changes.daysCount ?? 1, lastDay)) : undefined;
    const row = await this.store.update(userId, id, { ...changes, ...(daysCount !== undefined && { daysCount }) });
    if (!row) throw new SavedItineraryNotFoundError();
    return row;
  }

  async remove(userId: string, id: string) {
    if (!(await this.store.delete(userId, id))) throw new SavedItineraryNotFoundError();
  }
}
