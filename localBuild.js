/**
 * localBuild.js: test-build a FeatureScript custom feature on this computer, with no
 * Onshape API calls, using the FS-Lite interpreter + OpenCascade builder from onshape-fsgen
 * (MIT) via scripts/local_build.py. Calibrated against real Onshape: it agreed on 17/17
 * parts with known Onshape results (CANNOT_RESOLVE_ENTITIES, REVOLVE_FAILED, syntax errors
 * and missing functions included).
 *
 * Optional: available only where .fsgen/venv exists (see README "Local test build");
 * set LOCAL_BUILD_CHECK=0 to turn it off. Never throws; ok:null means "not checked".
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PYTHON = process.platform === "win32"
  ? path.join(ROOT, ".fsgen", "venv", "Scripts", "python.exe")
  : path.join(ROOT, ".fsgen", "venv", "bin", "python");
const SCRIPT = path.join(ROOT, "scripts", "local_build.py");
const TIMEOUT_MS = Number(process.env.LOCAL_BUILD_TIMEOUT_MS || 60000);

export function isLocalBuildAvailable() {
  return process.env.LOCAL_BUILD_CHECK !== "0" && existsSync(PYTHON) && existsSync(SCRIPT)
    && existsSync(path.join(ROOT, ".fsgen", "onshape-fsgen", "fsgen"));
}

/** { attempted, ok, error, line, metrics: { bodies, volume_mm3, bbox_mm }, skippedReason } */
export function localBuildFeatureScript(code) {
  if (!isLocalBuildAvailable()) {
    return Promise.resolve({ attempted: false, ok: null, skippedReason: "Local test build not installed." });
  }
  return new Promise(resolve => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = result => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const child = spawn(PYTHON, [SCRIPT, "--stdin"], { cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const timer = setTimeout(() => {
      child.kill();
      done({ attempted: true, ok: null, skippedReason: `Local test build timed out after ${TIMEOUT_MS / 1000}s.` });
    }, TIMEOUT_MS);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", err => {
      clearTimeout(timer);
      done({ attempted: false, ok: null, skippedReason: `Local test build could not start: ${err.message}` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).pop() || "";
      try {
        const result = JSON.parse(line);
        // ok === null: the local engine itself broke (not the part) - treat as unchecked.
        done({ attempted: true, ok: result.ok, error: result.error || null, line: result.line || 0, metrics: result.metrics || null, skippedReason: result.ok === null ? result.error : null });
      } catch {
        done({ attempted: true, ok: null, skippedReason: `Local test build gave no result: ${(stderr || stdout).slice(-300)}` });
      }
    });
    child.stdin.end(code);
  });
}
