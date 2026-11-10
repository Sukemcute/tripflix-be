import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttp } from 'pino-http';
import { expect, it, vi } from 'vitest';
import { loggerModule } from './index.js';

it('logs request metadata without exposing request or response secrets', () => {
  const forRoot = vi.spyOn(LoggerModule, 'forRoot');
  try {
    loggerModule({ service: 'test' });
    const options = forRoot.mock.calls[0]?.[0]?.pinoHttp;
    if (!options || Array.isArray(options) || !('serializers' in options)) {
      throw new Error('Expected HTTP logger options');
    }

    const request = new IncomingMessage(new Socket());
    request.method = 'POST';
    request.url = '/api/auth/login?secret=query-secret';
    request.headers = { authorization: 'Bearer access-secret', cookie: 'tripflix_refresh=cookie-secret' };
    Object.assign(request, { id: 'req-1', body: { password: 'password-secret' } });
    const response = new ServerResponse(request);
    response.setHeader('set-cookie', 'tripflix_refresh=refresh-secret; HttpOnly');
    response.writeHead(200);

    const write = vi.fn<(message: string) => void>();
    pinoHttp(options, { write }).logger.info({ req: request, res: response });

    const line = write.mock.calls[0]?.[0] ?? '';
    expect(line).not.toMatch(/(?:access|cookie|password|query|refresh)-secret/);
    expect(JSON.parse(line)).toMatchObject({
      req: { id: 'req-1', method: 'POST', url: '/api/auth/login' },
      res: { statusCode: 200 },
    });
  } finally {
    forRoot.mockRestore();
  }
});
