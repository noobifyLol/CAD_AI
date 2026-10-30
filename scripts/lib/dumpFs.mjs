// When FS_DUMP_DIR is set, test scripts also save each FeatureScript they generate
// there, so the Python simulator (fs_sim) can execute exactly the same outputs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function dumpFs(name, code) {
  const dir = process.env.FS_DUMP_DIR;
  if (!dir || !code) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.fs`), code);
}
