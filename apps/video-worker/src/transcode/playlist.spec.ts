import { QUALITY_RUNGS, type VideoMetadata } from './levels.js';
import { assertTailLongEnough, buildMasterPlaylist } from './playlist.js';

const PORTRAIT_VIDEO: VideoMetadata = { displayWidth: 1080, displayHeight: 1920, durationSeconds: 10, hasAudio: true };

describe('buildMasterPlaylist', () => {
  it('chỉ liệt kê các mức đã xong, đúng kích thước và bitrate đỉnh', () => {
    expect(buildMasterPlaylist(QUALITY_RUNGS.slice(0, 1), PORTRAIT_VIDEO)).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:6',
        '#EXT-X-INDEPENDENT-SEGMENTS',
        '#EXT-X-STREAM-INF:BANDWIDTH=498000,RESOLUTION=360x640,CODECS="avc1.4d401f,mp4a.40.2"',
        '360p/index.m3u8',
        '',
      ].join('\n'),
    );
  });

  it('liệt kê đủ các mức theo thứ tự', () => {
    const playlist = buildMasterPlaylist([...QUALITY_RUNGS], PORTRAIT_VIDEO);
    expect(playlist.match(/^\d+p\/index\.m3u8$/gm)).toEqual(['360p/index.m3u8', '540p/index.m3u8', '720p/index.m3u8']);
  });

  it('video không có tiếng thì không khai báo codec âm thanh, vì trình phát có thể từ chối', () => {
    const playlist = buildMasterPlaylist(QUALITY_RUNGS.slice(0, 1), { ...PORTRAIT_VIDEO, hasAudio: false });
    expect(playlist).toContain('CODECS="avc1.4d401f"');
    expect(playlist).toContain('BANDWIDTH=402000');
  });
});

describe('assertTailLongEnough', () => {
  const buildPlaylist = (...seconds: number[]) => seconds.map((value) => `#EXTINF:${value},\nseg.ts`).join('\n');

  it('nhận đoạn cuối từ 0,5 giây', () => {
    expect(() => assertTailLongEnough(buildPlaylist(2, 0.5))).not.toThrow();
  });

  it('từ chối đoạn cuối ngắn hơn 0,5 giây', () => {
    expect(() => assertTailLongEnough(buildPlaylist(2, 0.2))).toThrow('Đoạn cuối chỉ dài 0.2 giây');
  });

  it('video chỉ có một đoạn thì nhận dù ngắn', () => {
    expect(() => assertTailLongEnough(buildPlaylist(0.2))).not.toThrow();
  });

  it('báo lỗi khi playlist không có đoạn nào', () => {
    expect(() => assertTailLongEnough('#EXTM3U')).toThrow('Playlist không có đoạn video nào');
  });
});
