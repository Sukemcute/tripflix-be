/** Đường dẫn Socket.IO; gateway (traefik) chuyển /ws về notification-service. */
export const WS_PATH = '/ws';

/** Chỉ nhận WebSocket: không long-polling nên nhiều replica không cần sticky session. */
export const WS_TRANSPORTS = ['websocket'] as const;

/** Room riêng của mỗi người dùng. Server tự cho socket vào lúc bắt tay; client không chọn được room. */
export const userRoom = (userId: string) => `user:${userId}`;

/** Room theo phiên đăng nhập (sid), để ngắt đúng thiết bị khi phiên bị thu hồi. */
export const sessionRoom = (sid: string) => `sid:${sid}`;

/** Sự kiện server gửi ngay trước khi ngắt vì access token hết hạn: client làm mới token rồi kết nối lại. */
export const AUTH_EXPIRED_EVENT = 'auth.expired';

/** Mã lỗi trong connect_error (err.data.code) để client biết nên làm gì. */
export const WS_ERROR = {
  /** Thiếu token, token sai hoặc hết hạn, phiên đã thu hồi: làm mới token rồi kết nối lại. */
  unauthorized: 'unauthorized',
  /** Không kiểm được phiên (Redis lỗi): thử lại sau. */
  unavailable: 'unavailable',
} as const;

/** setTimeout chỉ nhận tối đa 2^31 - 1 ms (khoảng 24,8 ngày). */
export const MAX_TIMER_MS = 2 ** 31 - 1;
