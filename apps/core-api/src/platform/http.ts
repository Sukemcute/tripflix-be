import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Mọi API của core nằm dưới /api (gateway chuyển /api/* về đây); /health để ngoài. */
export function applyGlobalPrefix(app: INestApplication) {
  app.setGlobalPrefix('api', { exclude: ['health'] });
}

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Tripflix core-api')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupHttp(app: INestApplication, { swagger }: { swagger: boolean }) {
  applyGlobalPrefix(app);
  app.enableShutdownHooks();
  if (swagger) SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
