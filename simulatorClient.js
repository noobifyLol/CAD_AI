/**
 * simulatorClient.js — runs FeatureScript in fs_sim (the Python FeatureScript
 * simulator: real Onshape std library + OpenCascade kernel) from Node.
 *
 * One long-lived Python worker (fs_sim/worker.py) handles requests sequentially;
 * it is started lazily, restarted if it dies or hangs, and everything fails open:
 * if Python, OCP or the std library is missing, callers get { available: false }.
 *
 * Env:
 *   FS_SIM_ENABLED=false     turn the simulator off
 *   FS_SIM_PYTHON            Python with OCP installed (default: python3)
 *   FS_SIM_TIMEOUT_MS        per-request timeout (default 60000)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
// Default: the local test-build virtualenv (.fsgen/venv, see README) when present, since it
// already has OCP, numpy and matplotlib; otherwise python3.
const LOCAL_VENV_PYTHON = [join(ROOT, ".fsgen", "venv", "Scripts", "python.exe"), join(ROOT, ".fsgen", "venv", "bin", "python")]
  .find(candidate => existsSync(candidate));
const PYTHON = process.env.FS_SIM_PYTHON || LOCAL_VENV_PYTHON || "python3";
const ENABLED = String(process.env.FS_SIM_ENABLED || "true").toLowerCase() !== "false";
const TIMEOUT_MS = Number(process.env.FS_SIM_TIMEOUT_MS || 60000);
const STD_DIR = process.env.FS_STD_DIR || join(ROOT, "fs_sim", "std");

let status = null;
let worker = null;
let ready = null;
let buffer = "";
let nextId = 1;
const pending = new Map();

let statusPromise = null;

/** Starts the one-time availability check (imports OCP, parses the std library). */
export function probeSimulator() {
  if (statusPromise) return statusPromise;
  statusPromise = new Promise((resolve) => {
    const finish = (value) => {
      status = value;
      resolve(value);
    };
    if (!ENABLED) return finish({ available: false, reason: "Simulator disabled (FS_SIM_ENABLED=false)." });
    if (!existsSync(join(STD_DIR, "geometry.fs"))) {
      return finish({ available: false, reason: "Onshape std library not found; run fs_sim/fetch_std.sh." });
    }
    let output = "";
    let child;
    try {
      child = spawn(PYTHON, ["-c", "import OCP, numpy, matplotlib; from fs_sim.runtime import library; library(); print('ok')"], { cwd: ROOT });
    } catch (err) {
      return finish({ available: false, reason: `Simulator unavailable (${PYTHON}): ${err.message}` });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ available: false, reason: `Simulator unavailable (${PYTHON}): ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && output.includes("ok")) return finish({ available: true, reason: null });
      const detail = output.trim().split("\n").pop();
      finish({ available: false, reason: `Simulator unavailable (${PYTHON}): ${detail || "Python or OCP missing"}` });
    });
  });
  return statusPromise;
}

/** Last known { available, reason } (non-blocking). */
export function simulatorStatus() {
  if (!status) probeSimulator();
  return status || { available: false, reason: "Simulator check is still running." };
}

function startWorker() {
  worker = spawn(PYTHON, ["-m", "fs_sim.worker"], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  buffer = "";
  ready = new Promise((resolve) => {
    const onLine = (line) => {
      if (line.includes('"ready"')) resolve(true);
    };
    worker._onReady = onLine;
  });
  worker.stdout.setEncoding("utf8");
  worker.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      if (worker?._onReady && line.includes('"ready"')) {
        worker._onReady(line);
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = pending.get(message.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });
  worker.stderr.on("data", () => {});
  worker.on("exit", () => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: null, gaps: ["simulator worker exited"], errors: [], warnings: [], parts: [] });
    }
    pending.clear();
    worker = null;
    ready = null;
  });
}

/**
 * Simulate a feature. Resolves to
 * { available, ok, builds, parts, errors, warnings, gaps, png?, elapsedMs, reason? }.
 * `builds` is true when it ran without errors and produced at least one solid part.
 */
export async function simulateFeatureScript(code, { render = false } = {}) {
  const state = await probeSimulator();
  if (!state.available) return { available: false, reason: state.reason };
  if (!worker) startWorker();
  await ready;
  const id = nextId++;
  const response = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      try {
        worker?.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve({ id, ok: null, gaps: [`simulation timed out after ${TIMEOUT_MS} ms`], errors: [], warnings: [], parts: [] });
    }, TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    worker.stdin.write(`${JSON.stringify({ id, code, render })}\n`);
  });
  const errors = response.errors || [];
  const gaps = response.gaps || [];
  return {
    available: true,
    ok: response.ok ?? null,
    builds: response.ok === true && errors.length === 0 && (response.parts || []).length > 0,
    feature: response.feature || null,
    parts: response.parts || [],
    errors,
    warnings: response.warnings || [],
    gaps,
    png: response.png || null,
    elapsedMs: response.elapsedMs ?? null,
  };
}

export function stopSimulator() {
  try {
    worker?.kill();
  } catch {
    // ignore
  }
  worker = null;
}
