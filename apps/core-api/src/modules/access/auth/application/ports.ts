import type { Role } from '@tripflix/contracts';
import type { NewOutboxEvent } from '@tripflix/outbox';
import type { JWK } from 'jose';
import type { RefreshState } from '../domain/refresh-rotation.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: Role;
  status: 'active' | 'locked';
  createdAt: Date;
}

export interface SessionRecord extends RefreshState {
  id: string;
  userId: string;
}

/** Phiên hiện ở màn "thiết bị đã đăng nhập"; không có bản băm token. */
export interface SessionSummary {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface NewSession {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
}

export interface SessionRotation {
  refreshTokenHash: string;
  previousTokenHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  lastUsedAt: Date;
}

/** Service được xin token service-to-service. */
export interface ServiceClientRecord {
  clientId: string;
  secretHash: string;
  allowedAudiences: string[];
  createdAt: Date;
  disabledAt: Date | null;
}

export interface ServiceClientRepository {
  findById(clientId: string): Promise<ServiceClientRecord | null>;
  /** Trả null khi clientId đã có. */
  insert(client: Pick<ServiceClientRecord, 'clientId' | 'secretHash' | 'allowedAudiences'>): Promise<ServiceClientRecord | null>;
  /** Đặt disabled_at nếu đang bật; trả false khi không có client này. */
  disable(clientId: string, at: Date): Promise<boolean>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Trả null khi email đã có người dùng. */
  insert(user: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'>): Promise<UserRecord | null>;
  listStaff(): Promise<UserRecord[]>;
  /** Tìm theo email hoặc tên hiển thị (không phân biệt hoa thường), mới nhất trước. */
  search(options: { query?: string | undefined; limit: number; offset: number }): Promise<{ items: UserRecord[]; total: number }>;
  updateRole(id: string, role: UserRecord['role']): Promise<UserRecord | null>;
  updateStatus(id: string, status: UserRecord['status']): Promise<UserRecord | null>;
  updateDisplayName(id: string, displayName: string): Promise<UserRecord | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<UserRecord | null>;
}

export interface SessionRepository {
  insert(session: NewSession): Promise<SessionRecord>;
  /** Tìm phiên có token hiện tại hoặc token liền trước khớp bản băm. */
  findByTokenHash(hash: string): Promise<SessionRecord | null>;
  /** Cập nhật có điều kiện: chỉ đổi khi token hiện tại vẫn là expectedCurrentHash. Trả false nếu request khác đã đổi trước. */
  rotate(id: string, expectedCurrentHash: string, next: SessionRotation): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  /** Xoá mọi phiên của người dùng (trừ exceptId nếu có), trả về các sid đã xoá để chặn trong Redis. */
  deleteByUser(userId: string, exceptId?: string): Promise<string[]>;
  /** Chỉ xoá khi phiên thuộc đúng người dùng; trả false nếu không có phiên đó của người này. */
  deleteOwned(id: string, userId: string): Promise<boolean>;
  /** Phiên còn hạn của người dùng, dùng gần nhất trước. */
  listActiveByUser(userId: string, now: Date): Promise<SessionSummary[]>;
  /** Xoá phiên hết hạn trước mốc `before`, trả số dòng đã xoá. */
  deleteExpired(before: Date): Promise<number>;
}

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.refresh'
  | 'auth.refresh_reused'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.session_revoked'
  | 'auth.profile_updated'
  | 'auth.password_changed'
  | 'auth.password_change_failed'
  | 'service.token_failed'
  | 'service.client_created'
  | 'service.client_disabled'
  | 'staff.role_granted'
  | 'staff.role_revoked'
  | 'user.locked'
  | 'user.unlocked';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** Ghi sự kiện vào access.outbox_events; gọi trong transaction để sự kiện chỉ đi khi thay đổi đã commit. */
export interface AccessOutbox {
  add(event: NewOutboxEvent): Promise<string>;
}

/** Truy cập dữ liệu của access. Transaction do @Transactional('access') ở use case mở, repository tự dùng. */
export interface AccessStore {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditLog;
  outbox: AccessOutbox;
  serviceClients: ServiceClientRepository;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
}

export interface TokenIssuer {
  issue(claims: { userId: string; role: Role; sid: string }): Promise<IssuedAccessToken>;
  /** Token service-to-service: typ=service, sub=clientId, aud=service nhận, sống SERVICE_TOKEN_TTL_SECONDS. */
  issueServiceToken(claims: { clientId: string; audience: string }): Promise<IssuedAccessToken>;
  /** Khoá công khai cho /.well-known/jwks.json. */
  getJwks(): { keys: JWK[] };
}

export interface RateLimitStatus {
  isBlocked: boolean;
  retryAfterSeconds: number;
}

export interface LoginRateLimiter {
  check(email: string, ip: string): Promise<RateLimitStatus>;
  recordFailure(email: string, ip: string): Promise<void>;
  reset(email: string): Promise<void>;
}

export type Clock = () => Date;

/** Thông tin request ghi vào phiên và nhật ký. */
export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

export const ACCESS_STORE = Symbol('ACCESS_STORE');
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');
export const LOGIN_RATE_LIMITER = Symbol('LOGIN_RATE_LIMITER');
export const ACCESS_SID_BLOCKLIST = Symbol('ACCESS_SID_BLOCKLIST');
export const CLOCK = Symbol('CLOCK');
