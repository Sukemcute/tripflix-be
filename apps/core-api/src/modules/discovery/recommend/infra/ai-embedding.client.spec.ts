import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiEmbeddingClient } from './ai-embedding.client.js';

describe('AI embedding client qua HTTP thật', () => {
  let server: Server;
  let url: string;
  let tokenCalls: number;
  let batches: string[][];
  let status: number;
  let refreshOnce: boolean;
  let wrongCount: boolean;
  beforeEach(async () => {
    tokenCalls = 0;
    batches = [];
    status = 200;
    refreshOnce = false;
    wrongCount = false;
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { clientId?: string; audience?: string; texts?: string[] };
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/auth/service-token') {
        tokenCalls++;
        expect(body).toMatchObject({ clientId: 'core-api', audience: 'ai-service', clientSecret: 'secret' });
        response.end(JSON.stringify({ accessToken: `token-${tokenCalls}`, expiresIn: 300, tokenType: 'Bearer' }));
        return;
      }
      expect(request.url).toBe('/embed');
      if (refreshOnce && request.headers.authorization === 'Bearer token-1') {
        response.statusCode = 401;
        response.end('{}');
        return;
      }
      batches.push(body.texts!);
      response.statusCode = status;
      const texts = wrongCount ? body.texts!.slice(1) : body.texts!;
      response.end(JSON.stringify({ model: 'e5@1', vectors: texts.map((t) => [t.length, 0]) }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const client = () => new AiEmbeddingClient({ aiUrl: url, coreUrl: url, secret: 'secret', timeoutMs: 1000 });

  it('chia lô 64, giữ thứ tự, xin token một lần', async () => {
    const texts = Array.from({ length: 70 }, (_, i) => 'x'.repeat(i + 1));
    const out = await client().embed(texts);
    expect(batches.map((b) => b.length)).toEqual([64, 6]);
    expect(out).toEqual({ model: 'e5@1', vectors: texts.map((t) => [t.length, 0]) });
    expect(tokenCalls).toBe(1);
  });

  it('token hết hạn (401): xin lại một lần rồi gọi tiếp', async () => {
    refreshOnce = true;
    expect(await client().embed(['a'])).toEqual({ model: 'e5@1', vectors: [[1, 0]] });
    expect(tokenCalls).toBe(2);
  });

  it('chưa cấu hình, AI lỗi, sai số vector: trả null, không ném', async () => {
    expect(await new AiEmbeddingClient({ coreUrl: url, secret: 'secret' }).embed(['a'])).toBeNull();
    status = 503;
    expect(await client().embed(['a'])).toBeNull();
    status = 200;
    wrongCount = true;
    expect(await client().embed(['a', 'b'])).toBeNull();
    expect(await new AiEmbeddingClient({ aiUrl: 'http://127.0.0.1:1', coreUrl: 'http://127.0.0.1:1', secret: 's', timeoutMs: 200 }).embed(['a'])).toBeNull();
  });
});
