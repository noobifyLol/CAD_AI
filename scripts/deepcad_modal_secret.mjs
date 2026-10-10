// Stores the Text2CAD service's secrets on Modal (secret "cad-ai-text2cad"):
//   HF_TOKEN   from .env (needed to download the gated checkpoint at build time)
//   API_TOKEN  = DEEPCAD_MODEL_TOKEN from .env, generated on first run, so only your
//              website can call the service and spend your Modal credits.
// Values go through a temporary dotenv file that is deleted afterwards; nothing is printed.
// Run with: npm run deepcad:modal-secret   (after `modal setup`)
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

if (!env.HF_TOKEN) {
  console.error('HF_TOKEN is missing from .env (a Hugging Face read token with access to SadilKhan/Text2CAD).');
  process.exit(1);
}
let apiToken = env.DEEPCAD_MODEL_TOKEN;
if (!apiToken) {
  apiToken = randomBytes(24).toString('hex');
  appendFileSync(envPath, `\n# Password for the Text2CAD service on Modal (also set it on Render)\nDEEPCAD_MODEL_TOKEN=${apiToken}\n`);
  console.log('Generated DEEPCAD_MODEL_TOKEN and saved it to .env.');
}

const modal = process.platform === 'win32'
  ? path.join(root, '.text2cad', 'venv', 'Scripts', 'modal.exe')
  : path.join(root, '.text2cad', 'venv', 'bin', 'modal');
const dir = mkdtempSync(path.join(os.tmpdir(), 'cadai-secret-'));
const file = path.join(dir, 'secret.env');
try {
  writeFileSync(file, `HF_TOKEN=${env.HF_TOKEN}\nAPI_TOKEN=${apiToken}\n`, { mode: 0o600 });
  const result = spawnSync(modal, ['secret', 'create', 'cad-ai-text2cad', '--from-dotenv', file, '--force'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
