import { Inject, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { AUTH_VERIFIER, SID_BLOCKLIST, type AccessTokenVerifier, type SidBlocklist } from '@tripflix/auth';
import type { Server } from 'socket.io';
import { createHandshakeAuth, type RealtimeSocket } from './handshake-auth.js';
import {
  AUTH_EXPIRED_EVENT,
  MAX_TIMER_MS,
  WS_PATH,
  WS_TRANSPORTS,
  sessionRoom,
  userRoom,
} from './realtime.constants.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Kênh realtime /ws (TF26A). Không khai báo @SubscribeMessage nào: client chỉ nhận, không xin vào room được.
 * Mọi socket tự vào room user:<userId> và sid:<sid> lấy từ access token đã kiểm.
 */
@WebSocketGateway({ path: WS_PATH, transports: [...WS_TRANSPORTS], serveClient: false })
export class RealtimeGateway
  implements OnGatewayInit<Server>, OnGatewayConnection<RealtimeSocket>, OnGatewayDisconnect<RealtimeSocket>
{
  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    @Inject(AUTH_VERIFIER) private readonly verify: AccessTokenVerifier,
    @Inject(SID_BLOCKLIST) private readonly blocklist: SidBlocklist,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    server.use(
      createHandshakeAuth({
        verify: this.verify,
        blocklist: this.blocklist,
        onError: (err) => this.logger.error({ err }, 'Không kiểm được phiên khi bắt tay /ws'),
      }),
    );
    this.realtime.attach(server);
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    const { user } = socket.data;
    await socket.join([userRoom(user.userId), sessionRoom(user.sid)]);
    // Bắt tay chỉ kiểm token tại thời điểm đó: tới exp thì ngắt, client làm mới token rồi kết nối lại.
    const msLeft = user.exp * 1000 - Date.now();
    if (msLeft <= 0) {
      this.expire(socket);
      return;
    }
    socket.data.expiryTimer = setTimeout(() => this.expire(socket), Math.min(msLeft, MAX_TIMER_MS));
    this.logger.debug({ userId: user.userId, socketId: socket.id }, 'Đã kết nối /ws');
  }

  handleDisconnect(socket: RealtimeSocket): void {
    if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer);
  }

  private expire(socket: RealtimeSocket): void {
    socket.emit(AUTH_EXPIRED_EVENT, {});
    socket.disconnect(true);
  }
}
