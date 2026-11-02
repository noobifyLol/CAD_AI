// Runs after `npm install`. With FS_SIM_SETUP=1 it installs the FeatureScript simulator
// (fs_sim: Python + OpenCascade + Onshape's std library) into .fs-sim-venv for hosts with
// enough memory (~350 MB for the worker). Otherwise it does nothing.
// Never fails the install: without the simulator the site still works, just unchecked.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Opt-in only (FS_SIM_SETUP=1): on Render the site uses the simulator service on Modal
// (FS_SIM_URL) instead, because the local worker needs more memory than the free plan has.
const onRender = false;
if (!onRender && process.env.FS_SIM_SETUP !== "1") process.exit(0);

const run = (cmd, args) => {
  console.log(`[fs_sim setup] ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  return result.status === 0;
};
const VENV = ".fs-sim-venv";
const py = `${VENV}/bin/python`;

function makeVenv() {
  if (existsSync(py)) return true;
  if (run("python3", ["-m", "venv", VENV])) return true;
  // Some images ship Python without ensurepip: make the venv without pip, then add pip.
  return run("python3", ["-m", "venv", "--without-pip", VENV])
    && run("bash", ["-c", `curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && ${py} /tmp/get-pip.py -q`]);
}

function installPackages() {
  const pip = [py, "-m", "pip", "install", "--no-cache-dir", "-q"];
  if (run(pip[0], [...pip.slice(1), "-r", "fs_sim/requirements.txt"])) return true;
  // Pinned versions need Python 3.11+; fall back to the newest versions this Python supports.
  return run(pip[0], [...pip.slice(1), "cadquery-ocp", "numpy", "matplotlib"]);
}

let ok = false;
try {
  ok = makeVenv() && installPackages() && run("bash", ["fs_sim/fetch_std.sh"])
    && run(py, ["-c", "import OCP, numpy, matplotlib; print('[fs_sim setup] OCP import ok')"]);
} catch (err) {
  console.log(`[fs_sim setup] error: ${err.message}`);
}
console.log(ok ? "[fs_sim setup] simulator ready" : "[fs_sim setup] failed; the site will run without the simulator");
process.exit(0);
