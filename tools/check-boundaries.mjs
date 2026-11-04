// Kiểm ranh giới module (docs/architecture/11 §3.6). Chạy trong `pnpm lint`.
// 1. Module trong core-api chỉ được import module khác qua index.ts của module đó.
// 2. Thư mục domain/ không import @nestjs/* hay drizzle-orm.
// 3. App không import code của app khác.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = (p) => p.split(sep).join('/');
const IMPORT = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const errors = [];
const appsDir = join(root, 'apps');
for (const file of walk(appsDir)) {
  const rel = toPosix(relative(root, file));
  const [, app] = rel.split('/');
  const fromModule = /^apps\/core-api\/src\/modules\/([^/]+)\//.exec(rel)?.[1];
  const inDomain = rel.includes('/domain/');
  const source = readFileSync(file, 'utf8');

  for (const match of source.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (inDomain && (spec.startsWith('@nestjs/') || spec.startsWith('drizzle-orm'))) {
      errors.push(`${rel}: domain/ không được import "${spec}"`);
    }
    if (!spec.startsWith('.')) continue;
    const target = toPosix(relative(root, resolve(dirname(file), spec)));
    const targetApp = /^apps\/([^/]+)\//.exec(`${target}/`)?.[1];
    if (targetApp && targetApp !== app) {
      errors.push(`${rel}: app ${app} không được import code của app ${targetApp} ("${spec}")`);
    }
    const toModule = /^apps\/core-api\/src\/modules\/([^/]+)(\/.*)?$/.exec(target);
    if (fromModule && toModule && toModule[1] !== fromModule) {
      const rest = toModule[2] ?? '';
      if (rest !== '' && rest !== '/index.js' && rest !== '/index') {
        errors.push(`${rel}: chỉ được import module ${toModule[1]} qua index.ts, không import "${spec}"`);
      }
    }
  }
}

if (errors.length) {
  process.stderr.write(`Vi phạm ranh giới module:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Ranh giới module: không có vi phạm.\n');
