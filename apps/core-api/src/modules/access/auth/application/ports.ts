import type { Role } from '@tripflix/contracts';
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

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Trả null khi email đã có người dùng. */
  insert(user: Pick<UserRecord, 'email' | 'passwordHash' | 'displayName' | 'role'>): Promise<UserRecord | null>;
  listStaff(): Promise<UserRecord[]>;
}

export interface SessionRepository {
  insert(session: NewSession): Promise<SessionRecord>;
  /** Tìm phiên có token hiện tại hoặc token liền trước khớp bản băm. */
  findByTokenHash(hash: string): Promise<SessionRecord | null>;
  /** Cập nhật có điều kiện: chỉ đổi khi token hiện tại vẫn là expectedCurrentHash. Trả false nếu request khác đã đổi trước. */
  rotate(id: string, expectedCurrentHash: string, next: SessionRotation): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.refresh'
  | 'auth.refresh_reused'
  | 'auth.logout';

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

/** Truy cập dữ liệu của access; transaction() chạy fn trong một transaction database. */
export interface AccessStore {
  users: UserRepository;
  sessions: SessionRepository;
  audit: AuditLog;
  transaction<T>(fn: (tx: Omit<AccessStore, 'transaction'>) => Promise<T>): Promise<T>;
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
