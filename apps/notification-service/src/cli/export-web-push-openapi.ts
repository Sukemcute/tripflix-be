import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  SubscriptionSchema,
  RemoveSubscriptionSchema,
  WebPushConfigurationSchema,
  WebPushRegistrationSchema,
} from '../web-push/web-push.validation.js';

const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: 'openapi-3.0', io: 'input' });
const response = (value: z.ZodType) => ({
  description: 'Thành công',
  content: { 'application/json': { schema: schema(value) } },
});
const requestBody = (value: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: schema(value) } },
});
const security = [{ bearerAuth: [] }];
const document = {
  openapi: '3.0.3',
  info: { title: 'Tripflix Web Push', version: '1.0.0' },
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths: {
    '/notifications/web-push': {
      get: {
        operationId: 'getWebPushConfiguration',
        security,
        responses: { '200': response(WebPushConfigurationSchema), '401': { description: 'Chưa đăng nhập' } },
      },
      post: {
        operationId: 'registerWebPush',
        security,
        requestBody: requestBody(SubscriptionSchema),
        responses: {
          '201': response(WebPushRegistrationSchema),
          '400': { description: 'Endpoint/key không hợp lệ' },
          '401': { description: 'Chưa đăng nhập' },
          '503': { description: 'Chưa bật Web Push' },
        },
      },
      delete: {
        operationId: 'removeWebPush',
        security,
        requestBody: requestBody(RemoveSubscriptionSchema),
        responses: {
          '204': { description: 'Đã xóa đăng ký của người dùng hiện tại' },
          '400': { description: 'Endpoint không hợp lệ' },
          '401': { description: 'Chưa đăng nhập' },
        },
      },
    },
  },
};
const output = fileURLToPath(new URL('../../../../contracts/openapi/', import.meta.url));
mkdirSync(output, { recursive: true });
writeFileSync(`${output}notification-web-push.json`, `${JSON.stringify(document, null, 2)}\n`);
