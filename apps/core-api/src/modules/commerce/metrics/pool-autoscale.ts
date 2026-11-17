/** Mỗi lần đổi pool commerce tăng hoặc giảm chừng này kết nối. */
export const POOL_STEP = 5;
/** Có request chờ kết nối liên tục chừng này lượt đo (5 giây/lượt) thì tăng. */
export const BUSY_WINDOWS_TO_GROW = 2;
/** Không ai chờ kết nối liên tục chừng này lượt (5 phút) thì giảm một nấc. */
export const CALM_WINDOWS_TO_SHRINK = 60;
/**
 * Event loop trễ quá mức này nghĩa là Node đang quá tải (đo 16/11: lúc nghẽn thật p99 lên hàng trăm ms). Khi đó tăng pool
 * không giúp: request chờ là vì tiến trình không kịp xử lý chứ không phải thiếu kết nối, mở thêm chỉ dồn thêm việc.
 */
export const EVENT_LOOP_OVERLOADED_MS = 100;

export interface AutoscaleState {
  busyWindows: number;
  calmWindows: number;
}

export interface AutoscaleInput {
  current: number;
  /** Mức mặc định của pool (DEFAULT_POOL_SIZE.commerce): không bao giờ giảm dưới mức này. */
  base: number;
  /** Trần của bản này: min(trần mỗi bản, ngân sách chia đều cho số bản đang chạy). */
  cap: number;
  waiting: number;
  eventLoopDelayP99Ms: number;
  state: AutoscaleState;
}

/** Trần pool của một bản: ngân sách tổng chia cho số bản đang chạy, không vượt trần mỗi bản, không dưới mức mặc định. */
export function computePoolCap(input: { base: number; budget: number; ceiling: number; instances: number }): number {
  const share = Math.floor(input.budget / Math.max(1, input.instances));
  return Math.max(input.base, Math.min(input.ceiling, share));
}

/**
 * Quyết định số kết nối tối đa của pool commerce cho lượt đo này (L4, ý mentor: lưu lượng tăng bất thường thì nới pool).
 * Chỉ tăng khi request đang chờ kết nối mà Node còn rảnh; về yên thì giảm dần; luôn nằm trong [base, cap].
 */
export function decidePoolMax(input: AutoscaleInput): { next: number; state: AutoscaleState } {
  const { current, base, cap, waiting, eventLoopDelayP99Ms } = input;
  // Có thêm bản core-api thì trần mỗi bản thấp đi: hạ ngay để tổng không vượt ngân sách.
  if (current > cap) return { next: cap, state: { busyWindows: 0, calmWindows: 0 } };
  if (waiting > 0 && eventLoopDelayP99Ms < EVENT_LOOP_OVERLOADED_MS) {
    const busyWindows = input.state.busyWindows + 1;
    if (busyWindows >= BUSY_WINDOWS_TO_GROW && current < cap) return { next: Math.min(cap, current + POOL_STEP), state: { busyWindows: 0, calmWindows: 0 } };
    return { next: current, state: { busyWindows, calmWindows: 0 } };
  }
  if (waiting > 0) return { next: current, state: { busyWindows: 0, calmWindows: 0 } };
  const calmWindows = input.state.calmWindows + 1;
  if (calmWindows >= CALM_WINDOWS_TO_SHRINK && current > base) return { next: Math.max(base, current - POOL_STEP), state: { busyWindows: 0, calmWindows: 0 } };
  return { next: current, state: { busyWindows: 0, calmWindows } };
}
