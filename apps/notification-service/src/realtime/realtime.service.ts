import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { sessionRoom, userRoom } from './realtime.constants.js';

/**
 * Đẩy dữ liệu xuống client đang mở /ws. Các handler sự kiện gọi qua đây, không đụng Socket.IO trực tiếp.
 * Có Redis adapter thì lệnh phát và lệnh ngắt tới được socket ở mọi replica.
 * Client không mở kết nối thì không nhận gì: inbox (TF46) mới là nơi lưu thông báo, socket chỉ báo "có mới".
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('RealtimeService');
  private server: Server | undefined;

  /** Gateway gọi một lần sau khi Socket.IO khởi tạo. */
  attach(server: Server): void {
    this.server = server;
  }

  /** Gửi tới mọi thiết bị đang kết nối của người dùng. Trả false khi Socket.IO chưa sẵn sàng. */
  emitToUser(userId: string, event: string, data: unknown): boolean {
    if (!this.server) {
      this.logger.warn({ event }, 'Socket.IO chưa sẵn sàng, bỏ qua lần phát');
      return false;
    }
    this.server.to(userRoom(userId)).emit(event, data);
    return true;
  }

  /** Ngắt mọi kết nối của người dùng, ví dụ khi tài khoản bị khoá. */
  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }

  /** Ngắt các kết nối của một phiên đăng nhập (đăng xuất trên một thiết bị). */
  disconnectSession(sid: string): void {
    this.server?.in(sessionRoom(sid)).disconnectSockets(true);
  }
}
