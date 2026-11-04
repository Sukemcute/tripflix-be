import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { applyGlobalPrefix, buildOpenApiDocument } from '../platform/http.js';

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
