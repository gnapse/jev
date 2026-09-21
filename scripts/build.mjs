import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { schemas } from '../dist/core/schemas.js';

await mkdir(new URL('../schemas/', import.meta.url), { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  await writeFile(new URL(`../schemas/${name}.json`, import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
}
await chmod(new URL('../dist/index.js', import.meta.url), 0o755);
