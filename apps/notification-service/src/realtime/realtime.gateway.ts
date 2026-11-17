import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { z } from 'zod';
import { AUTH_VERIFIER, SID_BLOCKLIST, type AccessTokenVerifier, type SidBlocklist } from '@tripflix/auth';
import type { Server } from 'socket.io';
import { createHandshakeAuth, type RealtimeSocket } from './handshake-auth.js';
import {
  AUTH_EXPIRED_EVENT,
  STAFF_ROOM,
  MAX_TIMER_MS,
  MAX_WATCHED_POSTS,
  postRoom,
  WS_PATH,
  WS_TRANSPORTS,
  sessionRoom,
  userRoom,
} from './realtime.constants.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Kênh realtime /ws (TF26A). Mọi socket tự vào room user:<userId> và sid:<sid> lấy từ access token đã kiểm.
 * Client chỉ được xin vào room post:<postId> (TF99, tối đa 3); room đó chỉ nhận tín hiệu không có nội dung,
 * và chỉ của bài public, nên vào phòng bài private cũng không thấy gì.
 */
const PostWatchBodySchema = z.object({ postId: z.uuid() });

export type PostWatchAck = { ok: true } | { ok: false; code: 'invalid' | 'too_many' };

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
    if (user.role === 'moderator' || user.role === 'superadmin') await socket.join(STAFF_ROOM);
    // Bắt tay chỉ kiểm token tại thời điểm đó: tới exp thì ngắt, client làm mới token rồi kết nối lại.
    const msLeft = user.exp * 1000 - Date.now();
    if (msLeft <= 0) {
      this.expire(socket);
      return;
    }
    socket.data.expiryTimer = setTimeout(() => this.expire(socket), Math.min(msLeft, MAX_TIMER_MS));
    if (user.role === 'moderator' || user.role === 'superadmin') socket.emit('moderation.ready', {});
    this.logger.debug({ userId: user.userId, socketId: socket.id }, 'Đã kết nối /ws');
  }

  /** Web mở bài: vào phòng để nhận post.comments.changed. Ack cho biết lý do khi bị từ chối. */
  @SubscribeMessage('post.watch')
  async watchPost(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() body: unknown): Promise<PostWatchAck> {
    const parsed = PostWatchBodySchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    const room = postRoom(parsed.data.postId);
    if (socket.rooms.has(room)) return { ok: true };
    const watched = [...socket.rooms].filter((name) => name.startsWith('post:')).length;
    if (watched >= MAX_WATCHED_POSTS) return { ok: false, code: 'too_many' };
    await socket.join(room);
    return { ok: true };
  }

  @SubscribeMessage('post.unwatch')
  async unwatchPost(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() body: unknown): Promise<PostWatchAck> {
    const parsed = PostWatchBodySchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'invalid' };
    await socket.leave(postRoom(parsed.data.postId));
    return { ok: true };
  }

  handleDisconnect(socket: RealtimeSocket): void {
    if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer);
  }

  private expire(socket: RealtimeSocket): void {
    socket.emit(AUTH_EXPIRED_EVENT, {});
    socket.disconnect(true);
  }
}
