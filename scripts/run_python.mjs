// Runs a Python command with a project virtualenv's interpreter, on any OS.
// npm runs scripts through cmd.exe on Windows, which cannot start "./.venv/Scripts/python.exe".
// Usage: node scripts/run_python.mjs <venv dir> <python args...>
//   e.g. node scripts/run_python.mjs .venv model_service/cadfs_server.py
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const [venv, ...args] = process.argv.slice(2);
if (!venv) {
  console.error('Usage: node scripts/run_python.mjs <venv dir> <python args...>');
  process.exit(2);
}
const python = process.platform === 'win32'
  ? path.join(root, venv, 'Scripts', 'python.exe')
  : path.join(root, venv, 'bin', 'python');

if (!existsSync(python)) {
  const hint = venv.startsWith('.text2cad')
    ? 'Follow "Run it locally" in hf_space/README.md first.'
    : 'Follow the setup in model_service/README.md first.';
  console.error(`No Python found at ${python}. ${hint}`);
  process.exit(1);
}
const child = spawn(python, args, { cwd: root, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
