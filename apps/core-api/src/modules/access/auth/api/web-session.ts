import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DEFAULT_WEB_ORIGINS, type CoreEnv } from '../../../../platform/env.js';
import { CORE_ENV } from '../../../../platform/tokens.js';
import { REFRESH_TTL_MS } from '../domain/refresh-rotation.js';

export const REFRESH_COOKIE_NAME = 'tripflix_refresh';
/** Cookie chỉ gửi kèm các API dưới /api/auth (refresh, logout), không đi theo mọi request. */
export const REFRESH_COOKIE_PATH = '/api/auth';
/** Web, admin gửi header này để nhận refresh token trong cookie thay vì trong body. */
export const WEB_CLIENT_HEADER = 'x-tripflix-client';
export const UNTRUSTED_ORIGIN_MESSAGE = 'Nguồn gửi request không được phép';

/**
 * Đọc một cookie từ header Cookie (`a=1; b=2`). Tự viết để không thêm cookie-parser.
 * Giá trị mã hoá lỗi thì trả nguyên chuỗi; không có thì undefined.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function isWebClient(req: Request): boolean {
  return req.get(WEB_CLIENT_HEADER)?.trim().toLowerCase() === 'web';
}

/**
 * Refresh token cho web, admin: cookie HttpOnly (JavaScript của trang không đọc được), SameSite=Lax,
 * Secure ở production. Mọi request dùng cookie hoặc chế độ web phải có Origin nằm trong AUTH_WEB_ORIGINS,
 * nếu không trang lạ có thể khiến trình duyệt tự gửi cookie (CSRF).
 */
@Injectable()
export class WebSession {
  private readonly trustedOrigins: ReadonlySet<string>;
  private readonly isSecure: boolean;

  constructor(@Inject(CORE_ENV) env: CoreEnv) {
    // E2E cũ dựng env tay có thể thiếu biến này: dùng mặc định như khi parse env.
    this.trustedOrigins = new Set((env.AUTH_WEB_ORIGINS as string[] | undefined) ?? DEFAULT_WEB_ORIGINS);
    this.isSecure = env.NODE_ENV === 'production';
  }

  readRefreshToken(req: Request): string | undefined {
    return readCookie(req.get('cookie'), REFRESH_COOKIE_NAME) || undefined;
  }

  hasRefreshCookie(req: Request): boolean {
    return this.readRefreshToken(req) !== undefined;
  }

  /** Thiếu Origin hoặc Origin lạ: 403. */
  assertTrustedOrigin(req: Request): void {
    const origin = req.get('origin');
    if (!origin || !this.trustedOrigins.has(origin)) throw new ForbiddenException(UNTRUSTED_ORIGIN_MESSAGE);
  }

  setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecure,
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TTL_MS,
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: this.isSecure, path: REFRESH_COOKIE_PATH });
  }
}
