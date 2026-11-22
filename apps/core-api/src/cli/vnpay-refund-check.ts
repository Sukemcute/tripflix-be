import '../platform/load-env.js';
import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { PaymentUseCases } from '../modules/commerce/payment/application/payment.use-cases.js';

const orderId = z.uuid().safeParse(process.argv[2]);
if (!orderId.success) {
  process.stderr.write('Dùng: node dist/cli/vnpay-refund-check.js <orderId UUID>\n');
  process.exit(1);
}

// CLI chỉ xử lý đơn được chọn, không khởi động các job nền của ứng dụng.
process.env.APP_ROLE = 'api';
let app: INestApplicationContext | undefined;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const refunded = await app.get(PaymentUseCases).processRefunds(orderId.data);
  process.stdout.write(`${JSON.stringify({ orderId: orderId.data, refunded })}\n`);
} catch {
  process.stderr.write('Không xử lý được khoản hoàn. Kiểm tra cấu hình và thử lại theo lịch đối soát.\n');
  process.exitCode = 1;
} finally {
  await app?.close();
}
