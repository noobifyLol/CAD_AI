// Stores the FeatureScript simulator service's password on Modal (secret "cad-ai-fs-sim"):
//   FS_SIM_TOKEN  generated on first run and saved to .env, so only your website can call
//                 the service and spend your Modal credits. Set the same value on Render.
// The value goes through a temporary dotenv file that is deleted afterwards; nothing is printed.
// Run with: npm run sim:modal-secret   (after `modal setup`)
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = path.join(root, '.env');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]),
);
let token = env.FS_SIM_TOKEN;
if (!token) {
  token = randomBytes(24).toString('hex');
  appendFileSync(envPath, `\n# Password for the FeatureScript simulator on Modal (also set it on Render)\nFS_SIM_TOKEN=${token}\n`);
  console.log('Generated FS_SIM_TOKEN and saved it to .env.');
}
const modal = process.platform === 'win32'
  ? path.join(root, '.text2cad', 'venv', 'Scripts', 'modal.exe')
  : path.join(root, '.text2cad', 'venv', 'bin', 'modal');
const dir = mkdtempSync(path.join(os.tmpdir(), 'cadai-secret-'));
const file = path.join(dir, 'secret.env');
try {
  writeFileSync(file, `FS_SIM_TOKEN=${token}\n`, { mode: 0o600 });
  const result = spawnSync(modal, ['secret', 'create', 'cad-ai-fs-sim', '--from-dotenv', file, '--force'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
