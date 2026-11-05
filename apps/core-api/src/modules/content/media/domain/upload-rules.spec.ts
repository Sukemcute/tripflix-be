import { MediaError } from './errors.js';
import {
  MAX_DURATION_SECONDS,
  MAX_FILE_SIZE_BYTES,
  MAX_PART_COUNT,
  PART_SIZE_BYTES,
  assertAllPartsListed,
  assertWithinUploadLimits,
  buildAllPartNumbers,
  buildSourceRelativeKey,
  calculatePartCount,
  resolveRequestedPartNumbers,
  roundUpDurationSeconds,
} from './upload-rules.js';

function readErrorCode(action: () => unknown): string | undefined {
  try {
    action();
    return undefined;
  } catch (error) {
    return error instanceof MediaError ? error.code : 'unexpected';
  }
}

describe('giới hạn upload', () => {
  it('nhận video đúng 5 phút và đúng 1 GB', () => {
    expect(() => assertWithinUploadLimits(MAX_FILE_SIZE_BYTES, MAX_DURATION_SECONDS)).not.toThrow();
  });

  it('từ chối video dài hơn 5 phút', () => {
    expect(readErrorCode(() => assertWithinUploadLimits(1, MAX_DURATION_SECONDS + 1))).toBe('MEDIA_TOO_LARGE');
  });

  it('từ chối video lớn hơn 1 GB', () => {
    expect(readErrorCode(() => assertWithinUploadLimits(MAX_FILE_SIZE_BYTES + 1, 1))).toBe('MEDIA_TOO_LARGE');
  });

  it('làm tròn lên để phần lẻ không lọt qua giới hạn', () => {
    expect(roundUpDurationSeconds(300.5)).toBe(301);
    expect(roundUpDurationSeconds(30)).toBe(30);
  });
});

describe('số phần', () => {
  it.each([
    [1, 1],
    [PART_SIZE_BYTES, 1],
    [PART_SIZE_BYTES + 1, 2],
    [PART_SIZE_BYTES * 3, 3],
    [MAX_FILE_SIZE_BYTES, MAX_PART_COUNT],
  ])('file %i byte chia thành %i phần', (fileSizeBytes, expected) => {
    expect(calculatePartCount(fileSizeBytes)).toBe(expected);
  });

  it('liệt kê số phần từ 1', () => {
    expect(buildAllPartNumbers(PART_SIZE_BYTES * 2 + 1)).toEqual([1, 2, 3]);
  });

  it('bỏ số phần trùng', () => {
    expect(resolveRequestedPartNumbers(PART_SIZE_BYTES * 2, [2, 1, 2])).toEqual([2, 1]);
  });

  it('từ chối số phần vượt quá số phần của file', () => {
    expect(readErrorCode(() => resolveRequestedPartNumbers(PART_SIZE_BYTES * 2, [3]))).toBe(
      'MEDIA_INVALID_PART_NUMBER',
    );
  });

  it('nhận đủ các phần, không phân biệt thứ tự', () => {
    expect(() => assertAllPartsListed(PART_SIZE_BYTES * 2 + 1, [3, 1, 2])).not.toThrow();
  });

  it.each([
    ['thiếu phần', [1, 2]],
    ['thừa phần', [1, 2, 3, 4]],
    ['trùng phần', [1, 2, 2]],
    ['số phần ngoài phạm vi', [2, 3, 4]],
  ])('từ chối khi %s', (_label, partNumbers) => {
    expect(readErrorCode(() => assertAllPartsListed(PART_SIZE_BYTES * 2 + 1, partNumbers))).toBe(
      'MEDIA_UPLOAD_INCOMPLETE',
    );
  });
});

describe('khoá file gốc', () => {
  it('đặt đuôi theo loại file', () => {
    expect(buildSourceRelativeKey('a', 'video/mp4')).toBe('uploads/a/original.mp4');
    expect(buildSourceRelativeKey('a', 'video/quicktime')).toBe('uploads/a/original.mov');
  });
});
