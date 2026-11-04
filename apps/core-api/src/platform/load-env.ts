import { existsSync } from 'node:fs';

// Import đầu tiên trong main.ts: nạp .env (nếu có) trước khi các module khác đọc process.env.
if (existsSync('.env')) process.loadEnvFile('.env');
