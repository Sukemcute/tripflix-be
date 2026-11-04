import { exportPKCS8, generateKeyPair } from 'jose';

// pnpm --filter @tripflix/core-api auth:keygen: in khoá ES256 mới cho AUTH_JWT_PRIVATE_KEY (staging, demo).
// Dòng in ra đã đổi xuống dòng thành \n để dán thẳng vào .env hoặc GitHub secret. Không commit khoá này.
const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const pem = await exportPKCS8(privateKey);
process.stdout.write(`AUTH_JWT_PRIVATE_KEY="${pem.trim().replace(/\n/g, '\\n')}"\n`);
