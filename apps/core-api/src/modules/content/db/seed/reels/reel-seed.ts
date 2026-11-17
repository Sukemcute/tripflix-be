import { readFileSync } from 'node:fs';
import type { ContentSeed } from '../seed-content.js';
import {
  generateReelSeed,
  type ReelCatalogFlight,
  type ReelCatalogHotel,
  type ReelStops,
  type ReelVideo,
} from './generate-reels.js';

export const REEL_VIDEOS_FILE = 'src/modules/content/db/seed/reels/reel-videos.json';
export const REEL_STOPS_FILE = 'src/modules/content/db/seed/reels/reel-stops.json';
/** Mốc cố định để chạy lại ra đúng dữ liệu cũ (ngày đăng rải 120 ngày trước mốc này). */
export const REEL_SEED_NOW = new Date('2026-11-17T12:00:00+07:00');

/** Đọc 60 video và điểm dừng rồi sinh 1000 reel mẫu cho các tài khoản authorIds. */
export function buildReelSeed(input: {
  authorIds: string[];
  hotels: ReelCatalogHotel[];
  flights: ReelCatalogFlight[];
}): ContentSeed {
  return generateReelSeed({
    videos: JSON.parse(readFileSync(REEL_VIDEOS_FILE, 'utf8')) as ReelVideo[],
    stops: JSON.parse(readFileSync(REEL_STOPS_FILE, 'utf8')) as ReelStops,
    hotels: input.hotels,
    flights: input.flights,
    authorIds: input.authorIds,
    now: REEL_SEED_NOW,
  });
}
