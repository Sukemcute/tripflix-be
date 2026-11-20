import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { applyGlobalPrefix, buildOpenApiDocument } from '../platform/http.js';

// Hợp đồng dùng chung có cả API demo. Chỉ bật mock trong tiến trình xuất tài liệu.
process.env.NODE_ENV = 'development';
process.env.ENABLE_MOCK_PAYMENT = 'true';
const { AppModule } = await import('../app.module.js');

// preview: chỉ đọc metadata controller, không tạo kết nối database hay Redis.
const app = await NestFactory.create(AppModule, { preview: true, logger: false });
applyGlobalPrefix(app);
const document = buildOpenApiDocument(app);

// dist/cli/export-openapi.js → <repo>/contracts/openapi/
const outDir = fileURLToPath(new URL('../../../../contracts/openapi/', import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}core-api.json`, `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write('đã ghi contracts/openapi/core-api.json\n');
await app.close();
