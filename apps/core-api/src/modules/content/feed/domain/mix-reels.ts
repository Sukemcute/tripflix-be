/** Feed Reels (TF110): cứ `every` ô thì ô cuối là bài Hot, các ô còn lại là "Dành cho bạn" (mặc định 75% / 25%). */
export const MIX_REELS_DEFAULT_EVERY = 4;

export interface MixReelsInput {
  /** Id "Dành cho bạn" theo thứ tự xếp hạng, bắt đầu từ vị trí chưa dùng. */
  forYou: readonly string[];
  /** Id Hot theo thứ tự xếp hạng, bắt đầu từ vị trí chưa dùng. */
  hot: readonly string[];
  limit: number;
  every?: number;
  /** Id không được lên trang này, ví dụ bài đã có ở các trang trước của cùng phiên. */
  excludeIds?: Iterable<string>;
}

export interface MixReelsResult {
  /** Tối đa `limit` id, không trùng nhau, không có id trong `excludeIds`. */
  ids: string[];
  /** Số phần tử đầu của `forYou` đã đi qua, tính cả phần tử bị bỏ vì trùng hoặc bị loại. Trang sau bắt đầu từ vị trí này. */
  usedForYou: number;
  /** Như `usedForYou`, cho `hot`. */
  usedHot: number;
}

/**
 * Trộn hai danh sách id theo vị trí cố định: ô thứ `every`, `2×every`, ... lấy từ `hot`, ô còn lại lấy từ `forYou`.
 * - Id đã có trong trang hoặc nằm trong `excludeIds` thì bỏ qua, lấy phần tử kế tiếp của cùng nguồn.
 * - Một nguồn hết thì lấp bằng nguồn còn lại, nên trang chỉ ngắn hơn `limit` khi cả hai đều hết.
 */
export function mixReels({
  forYou,
  hot,
  limit,
  every = MIX_REELS_DEFAULT_EVERY,
  excludeIds = [],
}: MixReelsInput): MixReelsResult {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError('limit phải là số nguyên không âm');
  if (!Number.isInteger(every) || every < 2) throw new RangeError('every phải là số nguyên từ 2 trở lên');

  const ids: string[] = [];
  const blocked = new Set(excludeIds);
  const position = { forYou: 0, hot: 0 };
  const sources = { forYou, hot };

  const takeNext = (name: keyof typeof sources): boolean => {
    const list = sources[name];
    while (position[name] < list.length) {
      const id = list[position[name]++]!;
      if (blocked.has(id)) continue;
      blocked.add(id);
      ids.push(id);
      return true;
    }
    return false;
  };

  while (ids.length < limit) {
    const isHotSlot = (ids.length + 1) % every === 0;
    const [first, fallback] = isHotSlot ? (['hot', 'forYou'] as const) : (['forYou', 'hot'] as const);
    if (!takeNext(first) && !takeNext(fallback)) break;
  }

  return { ids, usedForYou: position.forYou, usedHot: position.hot };
}
