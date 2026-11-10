import { AUDIO_KBPS, MIN_TAIL_SECONDS, calculateOutputSize, type QualityRung, type VideoMetadata } from './levels.js';

// main profile, level 3.1: đủ cho 720p ở tối đa 30 khung hình mỗi giây.
const VIDEO_CODEC = 'avc1.4d401f';
const AUDIO_CODEC = 'mp4a.40.2';

/**
 * Worker ghi lại master mỗi khi xong thêm một mức, nên chỉ liệt kê các mức đã có trên S3.
 * Xếp mức cao nhất lên đầu: trình phát iOS bắt đầu từ mức đầu tiên rồi mới đo mạng, mà reels ngắn
 * thường hết trước khi kịp lên mức cao. Mạng yếu thì trình phát tự hạ xuống.
 */
export function buildMasterPlaylist(rungs: QualityRung[], video: VideoMetadata): string {
  const codecs = video.hasAudio ? `${VIDEO_CODEC},${AUDIO_CODEC}` : VIDEO_CODEC;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const rung of [...rungs].sort((a, b) => b.level - a.level)) {
    const { width, height } = calculateOutputSize(video, rung.level);
    // maxrate của video là 110% bitrate; BANDWIDTH phải là mức đỉnh.
    const peakKbps = Math.ceil(rung.videoKbps * 1.1) + (video.hasAudio ? AUDIO_KBPS : 0);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peakKbps * 1000},RESOLUTION=${width}x${height},CODECS="${codecs}"`,
      `${rung.level}p/index.m3u8`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Đoạn cuối quá ngắn làm trình phát đứng. Video chỉ có một đoạn thì không có đoạn nào để gộp, nên bỏ qua. */
export function assertTailLongEnough(levelPlaylist: string): void {
  const segmentSeconds = [...levelPlaylist.matchAll(/^#EXTINF:([\d.]+),/gm)].map((match) => Number(match[1]));
  if (segmentSeconds.length === 0) throw new Error('Playlist không có đoạn video nào');
  const tailSeconds = segmentSeconds.at(-1)!;
  if (segmentSeconds.length > 1 && tailSeconds < MIN_TAIL_SECONDS) {
    throw new Error(`Đoạn cuối chỉ dài ${tailSeconds} giây`);
  }
}
