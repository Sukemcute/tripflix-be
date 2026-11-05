import { buildEncodeArgs, buildPosterArgs, parseProbeOutput } from './ffmpeg.js';
import { QUALITY_RUNGS, type VideoMetadata } from './levels.js';

const buildProbe = (stream: object, ...otherStreams: object[]) =>
  JSON.stringify({
    format: { duration: '12.5' },
    streams: [{ codec_type: 'video', width: 1920, height: 1080, ...stream }, ...otherStreams],
  });

describe('parseProbeOutput', () => {
  it('đọc kích thước, thời lượng và âm thanh', () => {
    expect(parseProbeOutput(buildProbe({}, { codec_type: 'audio' }))).toEqual({
      displayWidth: 1920,
      displayHeight: 1080,
      durationSeconds: 12.5,
      hasAudio: true,
    });
  });

  it.each([
    ['side_data rotation -90', { side_data_list: [{ rotation: -90 }] }],
    ['side_data rotation 90', { side_data_list: [{ rotation: 90 }] }],
    ['side_data rotation 270', { side_data_list: [{ rotation: 270 }] }],
    ['tags rotate 90', { tags: { rotate: '90' } }],
  ])('video quay dọc có %s thì đổi chiều rộng và cao', (_label, stream) => {
    expect(parseProbeOutput(buildProbe(stream))).toMatchObject({ displayWidth: 1080, displayHeight: 1920 });
  });

  it('xoay 180 độ thì giữ nguyên chiều', () => {
    expect(parseProbeOutput(buildProbe({ side_data_list: [{ rotation: 180 }] }))).toMatchObject({
      displayWidth: 1920,
      displayHeight: 1080,
    });
  });

  it('báo không có tiếng khi thiếu luồng âm thanh', () => {
    expect(parseProbeOutput(buildProbe({})).hasAudio).toBe(false);
  });

  it('báo lỗi khi file không có luồng video', () => {
    const output = JSON.stringify({ format: { duration: '1' }, streams: [{ codec_type: 'audio' }] });
    expect(() => parseProbeOutput(output)).toThrow('File không có luồng video');
  });
});

describe('buildEncodeArgs', () => {
  const video: VideoMetadata = { displayWidth: 1080, displayHeight: 1920, durationSeconds: 10, hasAudio: true };
  const input = { sourcePath: '/tmp/source', outputDir: '/tmp/360p', rung: QUALITY_RUNGS[0]!, video };

  const readOption = (args: string[], name: string) => args[args.indexOf(name) + 1];

  it('video dọc scale theo chiều rộng, video ngang scale theo chiều cao', () => {
    expect(readOption(buildEncodeArgs(input), '-vf')).toBe('scale=360:-2');
    expect(
      readOption(buildEncodeArgs({ ...input, video: { ...video, displayWidth: 1920, displayHeight: 1080 } }), '-vf'),
    ).toBe('scale=-2:360');
  });

  it('không đặt keyframe trong giây cuối và dùng đúng bitrate của mức', () => {
    const args = buildEncodeArgs(input);
    expect(readOption(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*2)*lt(t,9.00)');
    expect(readOption(args, '-b:v')).toBe('365k');
    expect(readOption(args, '-maxrate')).toBe('402k');
    expect(readOption(args, '-bufsize')).toBe('730k');
  });

  it('bỏ metadata của file gốc để không lộ vị trí GPS', () => {
    expect(readOption(buildEncodeArgs(input), '-map_metadata')).toBe('-1');
  });

  it('ghi đoạn và playlist vào đúng thư mục của mức', () => {
    const args = buildEncodeArgs(input);
    expect(readOption(args, '-hls_segment_filename')).toBe('/tmp/360p/seg_%03d.ts');
    expect(args.at(-1)).toBe('/tmp/360p/index.m3u8');
  });

  it('video không có tiếng thì không chọn luồng và codec âm thanh', () => {
    const args = buildEncodeArgs({ ...input, video: { ...video, hasAudio: false } });
    expect(args).not.toContain('0:a:0');
    expect(args).not.toContain('-c:a');
  });
});

describe('buildPosterArgs', () => {
  it('lấy một khung hình theo chiều rộng yêu cầu', () => {
    const video: VideoMetadata = { displayWidth: 1080, displayHeight: 1920, durationSeconds: 10, hasAudio: true };
    const args = buildPosterArgs({ sourcePath: '/tmp/source', outputPath: '/tmp/p.jpg', width: 540, video });
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=540:-2');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
    expect(args[args.indexOf('-ss') + 1]).toBe('1.00');
    expect(args.at(-1)).toBe('/tmp/p.jpg');
  });
});
