import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Mọi API của core nằm dưới /api (gateway chuyển /api/* về đây).
 * /health và /.well-known/jwks.json để ngoài: service khác gọi thẳng core-api trong mạng nội bộ.
 */
export function applyGlobalPrefix(app: INestApplication) {
  app.setGlobalPrefix('api', { exclude: ['health', '.well-known/jwks.json'] });
}

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Tripflix core-api')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Chỉ web, admin trong AUTH_WEB_ORIGINS gọi được API từ trình duyệt, có gửi cookie (refresh token).
 * App mobile không bị CORS chặn nên không cần ở đây.
 */
export function applyCors(app: INestApplication, webOrigins: string[]) {
  app.enableCors({ origin: webOrigins, credentials: true, exposedHeaders: ['Retry-After'], maxAge: 600 });
}

export function setupHttp(app: INestApplication, { swagger, webOrigins }: { swagger: boolean; webOrigins: string[] }) {
  // Đứng sau Traefik: lấy IP người dùng từ X-Forwarded-For (một proxy) để chặn đăng nhập sai theo IP.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set('trust proxy', 1);
  applyGlobalPrefix(app);
  applyCors(app, webOrigins);
  app.enableShutdownHooks();
  if (swagger) SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
