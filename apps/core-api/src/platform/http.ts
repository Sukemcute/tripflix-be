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

/**
 * Header bảo mật cho mọi phản hồi (TF33), gồm cả lỗi và preflight CORS:
 * - `X-Frame-Options: DENY`: không cho trang khác nhúng API, Swagger vào iframe (clickjacking).
 * - `X-Content-Type-Options: nosniff`: trình duyệt không đoán lại kiểu nội dung (MIME sniffing).
 * - `Referrer-Policy`: chỉ gửi origin khi sang site khác, không lộ đường dẫn có id.
 * - `Strict-Transport-Security`: trình duyệt chỉ gọi API qua HTTPS trong 1 năm. Không có `preload`: vào danh sách
 *   preload của trình duyệt thì rất khó rút ra, cần Tech Lead quyết. Trình duyệt bỏ qua header này khi gọi qua HTTP
 *   (máy local).
 * Không gửi `X-XSS-Protection`: trình duyệt bỏ bộ lọc này rồi, OWASP khuyên không dùng.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function applySecurityHeaders(app: INestApplication) {
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    next();
  });
}

export function setupHttp(app: INestApplication, { swagger, webOrigins }: { swagger: boolean; webOrigins: string[] }) {
  // Đứng sau Traefik: lấy IP người dùng từ X-Forwarded-For (một proxy) để chặn đăng nhập sai theo IP.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set('trust proxy', 1);
  applySecurityHeaders(app);
  applyGlobalPrefix(app);
  applyCors(app, webOrigins);
  app.enableShutdownHooks();
  if (swagger) SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
