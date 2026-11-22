import type { MediaAspect, MediaQualityLevel } from '@tripflix/contracts';

export interface QualityRung {
  level: MediaQualityLevel;
  videoKbps: number;
}

// Thông số lấy từ lab/stream-lab/transcode.sh. Xếp từ thấp lên cao, vì làm mức thấp trước để đăng sớm.
export const QUALITY_RUNGS: readonly QualityRung[] = [
  { level: 360, videoKbps: 365 },
  { level: 540, videoKbps: 1100 },
  { level: 720, videoKbps: 2000 },
];

export const AUDIO_KBPS = 96;
export const SEGMENT_SECONDS = 2;
export const MIN_TAIL_SECONDS = 0.5;
export const MAX_FRAME_RATE = 30;
export const POSTER_WIDTHS = [360, 540, 720] as const;

/** Kích thước khi hiển thị, đã tính thông tin xoay của video quay từ điện thoại. */
export interface VideoMetadata {
  displayWidth: number;
  displayHeight: number;
  durationSeconds: number;
  hasAudio: boolean;
}

export interface OutputSize {
  width: number;
  height: number;
}

/** Không phóng to quá video gốc, nhưng luôn có 360p để video nhỏ vẫn phát được. */
export function selectRungs(video: VideoMetadata): QualityRung[] {
  const shortEdge = Math.min(video.displayWidth, video.displayHeight);
  const fittingRungs = QUALITY_RUNGS.filter((rung) => rung.level <= shortEdge);
  return fittingRungs.length > 0 ? fittingRungs : [QUALITY_RUNGS[0]!];
}

/** Mức chất lượng tính theo cạnh ngắn. H.264 yêu cầu kích thước chẵn. */
export function calculateOutputSize(video: VideoMetadata, level: MediaQualityLevel): OutputSize {
  const { displayWidth, displayHeight } = video;
  if (displayHeight > displayWidth) {
    return { width: level, height: roundToEven((displayHeight * level) / displayWidth) };
  }
  return { width: roundToEven((displayWidth * level) / displayHeight), height: level };
}

function roundToEven(value: number): number {
  return Math.round(value / 2) * 2;
}

/** Cột aspect chỉ nhận 3 giá trị. Video từ 4:5 tới 5:4 tính là vuông, nên 3:4 tính là dọc và 4:3 tính là ngang. */
export function classifyAspect(video: VideoMetadata): MediaAspect {
  const ratio = video.displayWidth / video.displayHeight;
  if (ratio < 4 / 5) return '9:16';
  if (ratio > 5 / 4) return '16:9';
  return '1:1';
}

/** Cột duration_sec là số nguyên, làm tròn lên giống lúc nhận thời lượng từ app. */
export function roundUpDurationSeconds(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds));
}

/** Không đặt keyframe trong giây cuối, để đoạn cuối không quá ngắn làm trình phát đứng. */
export function calculateLastKeyframeSeconds(durationSeconds: number): number {
  return Math.max(0, durationSeconds - 1);
}

/** Vị trí lấy ảnh bìa: giây đầu thường đen, nhưng video ngắn thì lấy giữa video. */
export function calculatePosterSeconds(durationSeconds: number): number {
  return Math.min(1, durationSeconds / 2);
}
