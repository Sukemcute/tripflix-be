// pnpm db:generate <module>: sinh migration cho đúng một module (docs/architecture/11 §3.4).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const MODULES = ['access', 'content', 'discovery', 'analytics', 'commerce'];
const [mod, ...rest] = process.argv.slice(2);
if (!MODULES.includes(mod)) {
  process.stderr.write(`Dùng: pnpm db:generate <module>, module là một trong: ${MODULES.join(', ')}\n`);
  process.exit(1);
}
const config = `src/modules/${mod}/db/drizzle.config.ts`;
if (!existsSync(config)) {
  process.stderr.write(`Không thấy ${config}\n`);
  process.exit(1);
}
const r = spawnSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--config', config, ...rest], {
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status ?? 1);
