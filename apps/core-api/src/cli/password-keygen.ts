import { generatePasswordKey } from '../modules/access/auth/infra/x25519-password-keyring.js';

// pnpm --filter @tripflix/core-api auth:password-keygen [keyId]: in khoá X25519 mới cho AUTH_PASSWORD_KEYS (TF056).
// Đổi khoá: đặt khoá mới lên đầu, giữ khoá cũ phía sau ít nhất 10 phút ("k2:<mới>,k1:<cũ>"). Không commit khoá này.
const keyId = process.argv[2] ?? `k${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) {
  process.stderr.write('keyId chỉ gồm chữ, số, "_" hoặc "-", tối đa 32 ký tự\n');
  process.exit(1);
}
process.stdout.write(`AUTH_PASSWORD_KEYS="${keyId}:${generatePasswordKey()}"\n`);
