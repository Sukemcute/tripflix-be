import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { exportedSchemas } from './index.js';

// dist/export-schemas.js → <repo>/contracts/events/
const outDir = fileURLToPath(new URL('../../../contracts/events/', import.meta.url));
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(exportedSchemas)) {
  const json = z.toJSONSchema(schema);
  writeFileSync(`${outDir}${name}.schema.json`, `${JSON.stringify(json, null, 2)}\n`);
  process.stdout.write(`đã ghi contracts/events/${name}.schema.json\n`);
}
