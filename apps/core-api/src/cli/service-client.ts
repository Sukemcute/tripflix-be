import '../platform/load-env.js';
import { loadEnv } from '@tripflix/config';
import { createDb, createPool } from '@tripflix/db';
import { Argon2PasswordHasher } from '../modules/access/auth/infra/argon2-password-hasher.js';
import { DrizzleAccessStore } from '../modules/access/auth/infra/drizzle-access.store.js';
import {
  disableServiceClient,
  registerServiceClient,
} from '../modules/access/service/application/service-token.use-cases.js';
import { coreEnvSchema } from '../platform/env.js';

// Tạo, vô hiệu hoá client xin token service-to-service (docs/10 §3.10):
//   pnpm --filter @tripflix/core-api auth:create-service-client <clientId> <audience...>
//   pnpm --filter @tripflix/core-api auth:disable-service-client <clientId>
// Secret chỉ in ra một lần; database giữ bản băm argon2. Cất secret vào biến môi trường của service đó, không commit.
const USAGE =
  'Dùng: auth:create-service-client <clientId> <audience...>  (ví dụ: ai-service core-api)\n' +
  '      auth:disable-service-client <clientId>\n';

const [command, clientId, ...audiences] = process.argv.slice(2);
if (!clientId || (command === 'create' && audiences.length === 0) || (command !== 'create' && command !== 'disable')) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const env = loadEnv(coreEnvSchema);
const pool = createPool({ url: env.DATABASE_URL_ACCESS, max: 1, applicationName: 'cli:service-client' });
try {
  const db = createDb(pool);
  const store = new DrizzleAccessStore(() => db);
  if (command === 'create') {
    const { clientSecret } = await registerServiceClient(
      { store, hasher: new Argon2PasswordHasher(), userAudience: env.AUTH_JWT_AUDIENCE },
      { clientId, audiences },
    );
    process.stdout.write(
      `Đã tạo client ${clientId}, được gọi: ${[...new Set(audiences)].join(', ')}\n` +
        `SERVICE_CLIENT_ID=${clientId}\nSERVICE_CLIENT_SECRET=${clientSecret}\n` +
        'Secret chỉ hiện một lần. Cất vào secret của service đó, không commit.\n',
    );
  } else {
    await disableServiceClient({ store, now: () => new Date() }, clientId);
    process.stdout.write(`Đã vô hiệu hoá ${clientId}: không cấp token mới, token đã cấp hết hạn sau tối đa 5 phút\n`);
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
