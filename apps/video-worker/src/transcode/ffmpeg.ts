import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import {
  AUDIO_KBPS,
  MAX_FRAME_RATE,
  SEGMENT_SECONDS,
  calculateLastKeyframeSeconds,
  calculatePosterSeconds,
  type QualityRung,
  type VideoMetadata,
} from './levels.js';

export interface EncodeLevelInput {
  sourcePath: string;
  outputDir: string;
  rung: QualityRung;
  video: VideoMetadata;
  signal: AbortSignal;
}

export interface CreatePosterInput {
  sourcePath: string;
  outputPath: string;
  width: number;
  video: VideoMetadata;
  signal: AbortSignal;
}

/** Tách khỏi FFmpeg để test xử lý việc chạy được trên CI, nơi không cài FFmpeg. */
export interface Transcoder {
  probe(sourcePath: string, signal: AbortSignal): Promise<VideoMetadata>;
  /** Ghi index.m3u8 và các đoạn seg_###.ts vào outputDir. */
  encodeLevel(input: EncodeLevelInput): Promise<void>;
  createPoster(input: CreatePosterInput): Promise<void>;
}

const ProbeOutputSchema = z.object({
  format: z.object({ duration: z.coerce.number().positive() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      tags: z.object({ rotate: z.coerce.number().optional() }).optional(),
      side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
    }),
  ),
});

/** ffprobe báo kích thước trước khi xoay. Điện thoại quay dọc thường lưu video ngang kèm thông tin xoay 90 độ. */
export function parseProbeOutput(output: string): VideoMetadata {
  const probe = ProbeOutputSchema.parse(JSON.parse(output));
  const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!videoStream?.width || !videoStream.height) throw new Error('File không có luồng video');

  const rotation =
    videoStream.side_data_list?.find((sideData) => sideData.rotation !== undefined)?.rotation ??
    videoStream.tags?.rotate ??
    0;
  const isSideways = Math.abs(rotation) % 180 === 90;
  return {
    displayWidth: isSideways ? videoStream.height : videoStream.width,
    displayHeight: isSideways ? videoStream.width : videoStream.height,
    durationSeconds: probe.format.duration,
    hasAudio: probe.streams.some((stream) => stream.codec_type === 'audio'),
  };
}

export function buildEncodeArgs({ sourcePath, outputDir, rung, video }: Omit<EncodeLevelInput, 'signal'>): string[] {
  const { level, videoKbps } = rung;
  const isPortrait = video.displayHeight > video.displayWidth;
  const lastKeyframeSeconds = calculateLastKeyframeSeconds(video.durationSeconds).toFixed(2);
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    ...(video.hasAudio ? ['-map', '0:a:0'] : []),
    // Bỏ metadata của file gốc, vì có thể chứa vị trí GPS mà file HLS thì công khai.
    '-map_metadata',
    '-1',
    '-vf',
    isPortrait ? `scale=${level}:-2` : `scale=-2:${level}`,
    '-fpsmax',
    String(MAX_FRAME_RATE),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    '-sc_threshold',
    '0',
    // Các mức có keyframe cùng thời điểm thì trình phát đổi mức không bị giật.
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})*lt(t,${lastKeyframeSeconds})`,
    '-b:v',
    `${videoKbps}k`,
    '-maxrate',
    `${Math.ceil(videoKbps * 1.1)}k`,
    '-bufsize',
    `${videoKbps * 2}k`,
    ...(video.hasAudio ? ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2'] : []),
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    join(outputDir, 'seg_%03d.ts'),
    join(outputDir, 'index.m3u8'),
  ];
}

export function buildPosterArgs({ sourcePath, outputPath, width, video }: Omit<CreatePosterInput, 'signal'>): string[] {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    calculatePosterSeconds(video.durationSeconds).toFixed(2),
    '-i',
    sourcePath,
    '-map_metadata',
    '-1',
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-2`,
    '-q:v',
    '4',
    outputPath,
  ];
}

const MAX_CAPTURED_OUTPUT_CHARS = 1_000_000;

/** Chạy lệnh ngoài. Dùng spawn với mảng tham số, không qua shell, nên đường dẫn không bị diễn giải thành lệnh. */
function runCommand(command: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT_CHARS) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // Chỉ giữ phần cuối, nơi FFmpeg ghi lỗi.
      stderr = `${stderr}${chunk.toString()}`.slice(-2_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} thoát mã ${code}: ${stderr.trim()}`));
    });
  });
}

export class FfmpegTranscoder implements Transcoder {
  async probe(sourcePath: string, signal: AbortSignal): Promise<VideoMetadata> {
    const output = await runCommand(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', sourcePath],
      signal,
    );
    return parseProbeOutput(output);
  }

  async encodeLevel({ signal, ...input }: EncodeLevelInput): Promise<void> {
    await runCommand('ffmpeg', buildEncodeArgs(input), signal);
  }

  async createPoster({ signal, ...input }: CreatePosterInput): Promise<void> {
    await runCommand('ffmpeg', buildPosterArgs(input), signal);
  }
}
