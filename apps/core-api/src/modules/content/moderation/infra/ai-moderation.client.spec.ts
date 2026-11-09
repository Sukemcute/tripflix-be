import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiModerationClient } from './ai-moderation.client.js';
import type { ModerationItem } from '../application/ports.js';

describe('AI moderation client qua HTTP thật', () => {
  let server: Server;
  let url: string;
  let tokenCalls: number;
  let calls: number;
  let status: number;
  let wrongId: boolean;
  let slow: boolean;
  let refreshOnce: boolean;
  let batchSizes: number[];
  const item: ModerationItem = { id: 'post:1', text: 'Bài viết', imageUrls: [] };
  beforeEach(async () => {
    tokenCalls = 0;
    calls = 0;
    status = 200;
    wrongId = false;
    slow = false;
    refreshOnce = false;
    batchSizes = [];
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        clientId: string;
        audience: string;
        items: ModerationItem[];
      };
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/auth/service-token') {
        tokenCalls++;
        expect(body.clientId).toBe('core-api');
        expect(body.audience).toBe('ai-service');
        response.end(
          JSON.stringify({ accessToken: `token-${tokenCalls}`, expiresIn: 300, tokenType: 'Bearer' }),
        );
        return;
      }
      calls++;
      batchSizes.push(body.items.length);
      if (slow) await new Promise((resolve) => setTimeout(resolve, 100));
      response.statusCode = refreshOnce && calls === 1 ? 401 : status;
      response.end(
        JSON.stringify({
          model: 'omni',
          results: body.items.map((input) => ({
            id: wrongId ? 'other' : input.id,
            flagged: true,
            categories: { 'harassment/threatening': true },
            scores: { 'harassment/threatening': 0.9 },
          })),
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const client = (timeoutMs = 3000) =>
    new AiModerationClient({ aiUrl: url, coreUrl: url, secret: 'test-only', timeoutMs });
  it('200 giữ nhãn; cache token dùng chung cả request đồng thời', async () => {
    const ai = client();
    const results = await Promise.all(Array.from({ length: 5 }, () => ai.moderate([item])));
    expect(tokenCalls).toBe(1);
    expect(calls).toBe(5);
    expect(results[0]?.[0]?.categories).toEqual({ 'harassment/threatening': true });
  });
  it('401 xin token mới và thử lại đúng một lần', async () => {
    refreshOnce = true;
    expect(await client().moderate([item])).not.toBeNull();
    expect(tokenCalls).toBe(2);
    expect(calls).toBe(2);
  });
  it.each([401, 403, 422, 502, 503, 504])('HTTP %s cuối cùng fallback toàn lô', async (code) => {
    status = code;
    expect(await client().moderate([item])).toBeNull();
    expect(calls).toBe(code === 401 ? 2 : 1);
  });
  it('timeout fallback không retry', async () => {
    slow = true;
    expect(await client(40).moderate([item])).toBeNull();
    expect(calls).toBe(1);
  });
  it('response sai ID fallback', async () => {
    wrongId = true;
    expect(await client().moderate([item])).toBeNull();
  });
  it('chia lô tối đa 20, một item mỗi kết quả', async () => {
    const result = await client().moderate(
      Array.from({ length: 41 }, (_, index) => ({ ...item, id: `post:${index}` })),
    );
    expect(result).toHaveLength(41);
    expect(batchSizes).toEqual([20, 20, 1]);
  });
  it('thiếu config chỉ dùng regex, không gọi mạng', async () => {
    expect(await new AiModerationClient({}).moderate([item])).toBeNull();
    expect(calls).toBe(0);
    expect(tokenCalls).toBe(0);
  });
});
