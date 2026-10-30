// Runs the FeatureScript simulator suite (fs_sim) on the library examples and on every
// FeatureScript the generators emit in the other test scripts.
// Needs Python with fs_sim/requirements.txt installed and fs_sim/fetch_std.sh run once.
//   npm run test:sim            (FS_SIM_PYTHON picks the Python; default python3)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.FS_SIM_PYTHON || 'python3';
const corpus = mkdtempSync(join(tmpdir(), 'fs-corpus-'));
try {
  for (const script of ['validator_regression.mjs', 'plan_compiler_check.mjs', 'deepcad_compiler_check.mjs', 'prompt_fallback_check.mjs']) {
    const dump = spawnSync(process.execPath, [join(root, 'scripts', script)], { cwd: root, env: { ...process.env, FS_DUMP_DIR: corpus }, encoding: 'utf8' });
    if (dump.status !== 0) {
      console.error(`${script} failed while dumping the corpus:\n${dump.stdout}${dump.stderr}`);
      process.exit(1);
    }
  }
  const run = spawnSync(python, ['-m', 'fs_sim.tests.run_all', corpus], { cwd: root, stdio: 'inherit' });
  process.exit(run.status ?? 1);
} finally {
  rmSync(corpus, { recursive: true, force: true });
}
