import type { Request, Response } from 'express';
import type { CoreEnv } from '../../../../platform/env.js';
import { REFRESH_COOKIE_NAME, WebSession, isWebClient, readCookie } from './web-session.js';

const fakeRequest = (headers: Record<string, string>) =>
  ({ get: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

describe('readCookie', () => {
  it('lấy đúng cookie theo tên, bỏ khoảng trắng', () => {
    expect(readCookie('a=1; tripflix_refresh=abc ;b=2', 'tripflix_refresh')).toBe('abc');
    expect(readCookie('tripflix_refresh=abc', 'tripflix_refresh')).toBe('abc');
  });

  it('không nhầm tên có cùng phần đuôi hay phần đầu', () => {
    expect(readCookie('old_tripflix_refresh=x; tripflix_refresh_v2=y', 'tripflix_refresh')).toBeUndefined();
  });

  it('giải mã %XX, bỏ ngoặc kép; mã hoá lỗi thì trả nguyên chuỗi', () => {
    expect(readCookie('t=a%2Bb', 't')).toBe('a+b');
    expect(readCookie('t="quoted"', 't')).toBe('quoted');
    expect(readCookie('t=%E0%A4%A', 't')).toBe('%E0%A4%A');
  });

  it('giá trị có dấu = vẫn đọc đủ; không có header hoặc không có cookie thì undefined', () => {
    expect(readCookie('t=a=b==', 't')).toBe('a=b==');
    expect(readCookie(undefined, 't')).toBeUndefined();
    expect(readCookie('', 't')).toBeUndefined();
    expect(readCookie('khong-co-dau-bang; x=1', 't')).toBeUndefined();
  });
});

describe('WebSession', () => {
  const env = (nodeEnv: string) =>
    ({ NODE_ENV: nodeEnv, AUTH_WEB_ORIGINS: ['http://localhost:3100'] }) as unknown as CoreEnv;

  it('isWebClient chỉ nhận đúng giá trị web', () => {
    expect(isWebClient(fakeRequest({ 'x-tripflix-client': 'web' }))).toBe(true);
    expect(isWebClient(fakeRequest({ 'x-tripflix-client': ' WEB ' }))).toBe(true);
    expect(isWebClient(fakeRequest({ 'x-tripflix-client': 'mobile' }))).toBe(false);
    expect(isWebClient(fakeRequest({}))).toBe(false);
  });

  it('Origin phải khớp chính xác, thiếu Origin cũng bị chặn', () => {
    const web = new WebSession(env('test'));
    expect(() => web.assertTrustedOrigin(fakeRequest({ origin: 'http://localhost:3100' }))).not.toThrow();
    expect(() => web.assertTrustedOrigin(fakeRequest({ origin: 'http://localhost:3100.evil.com' }))).toThrow();
    expect(() => web.assertTrustedOrigin(fakeRequest({ origin: 'null' }))).toThrow();
    expect(() => web.assertTrustedOrigin(fakeRequest({}))).toThrow();
  });

  it('production bật Secure; dev, test thì không (localhost chạy http)', () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const res = { cookie: (...args: [string, string, Record<string, unknown>]) => calls.push(args) } as unknown as Response;
    new WebSession(env('production')).setRefreshCookie(res, 'tok');
    new WebSession(env('development')).setRefreshCookie(res, 'tok');
    expect(calls[0]).toEqual([
      REFRESH_COOKIE_NAME,
      'tok',
      { httpOnly: true, sameSite: 'lax', secure: true, path: '/api/auth', maxAge: 30 * 24 * 60 * 60 * 1000 },
    ]);
    expect(calls[1]?.[2]).toMatchObject({ secure: false });
  });
});
