import {
  calculateLastKeyframeSeconds,
  calculateOutputSize,
  calculatePosterSeconds,
  classifyAspect,
  roundUpDurationSeconds,
  selectRungs,
  type VideoMetadata,
} from './levels.js';

const buildVideo = (displayWidth: number, displayHeight: number): VideoMetadata => ({
  displayWidth,
  displayHeight,
  durationSeconds: 10,
  hasAudio: true,
});

describe('selectRungs', () => {
  it.each([
    [1080, 1920, [360, 540, 720]],
    [720, 1280, [360, 540, 720]],
    [540, 960, [360, 540]],
    [1920, 1080, [360, 540, 720]],
    [360, 640, [360]],
  ])('video %ix%i có các mức %j, tính theo cạnh ngắn', (width, height, expected) => {
    expect(selectRungs(buildVideo(width, height)).map((rung) => rung.level)).toEqual(expected);
  });

  it('video nhỏ hơn 360p vẫn có mức 360 để phát được', () => {
    expect(selectRungs(buildVideo(240, 426)).map((rung) => rung.level)).toEqual([360]);
  });
});

describe('calculateOutputSize', () => {
  it('video dọc lấy chiều rộng theo mức', () => {
    expect(calculateOutputSize(buildVideo(1080, 1920), 360)).toEqual({ width: 360, height: 640 });
    expect(calculateOutputSize(buildVideo(1080, 1920), 720)).toEqual({ width: 720, height: 1280 });
  });

  it('video ngang lấy chiều cao theo mức', () => {
    expect(calculateOutputSize(buildVideo(1920, 1080), 540)).toEqual({ width: 960, height: 540 });
  });

  it('luôn ra kích thước chẵn', () => {
    expect(calculateOutputSize(buildVideo(1081, 1921), 360).height % 2).toBe(0);
  });
});

describe('classifyAspect', () => {
  it.each([
    [1080, 1920, '9:16'],
    [1920, 1080, '16:9'],
    [1000, 1000, '1:1'],
    [1080, 1440, '9:16'],
    [1440, 1080, '16:9'],
    [1000, 1100, '1:1'],
  ])('video %ix%i là %s', (width, height, expected) => {
    expect(classifyAspect(buildVideo(width, height))).toBe(expected);
  });
});

describe('tính thời gian', () => {
  it('làm tròn thời lượng lên số nguyên, tối thiểu 1 giây', () => {
    expect(roundUpDurationSeconds(42.1)).toBe(43);
    expect(roundUpDurationSeconds(0.2)).toBe(1);
  });

  it('không đặt keyframe trong giây cuối', () => {
    expect(calculateLastKeyframeSeconds(10)).toBe(9);
    expect(calculateLastKeyframeSeconds(0.5)).toBe(0);
  });

  it('ảnh bìa lấy ở giây thứ 1, video ngắn thì lấy giữa video', () => {
    expect(calculatePosterSeconds(10)).toBe(1);
    expect(calculatePosterSeconds(1)).toBe(0.5);
  });
});
