// Runs after `npm install`. On Render's native Node runtime (no Docker) it installs the
// FeatureScript simulator (fs_sim: Python + OpenCascade + Onshape's std library) so the live
// site test-builds every part. Elsewhere it does nothing (set FS_SIM_SETUP=1 to force it).
// Never fails the install: without the simulator the site still works, just unchecked.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.RENDER !== "true" && process.env.FS_SIM_SETUP !== "1") process.exit(0);
const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status === 0;
const py = ".fs-sim-venv/bin/python";
const ok = (existsSync(py) || run("python3", ["-m", "venv", ".fs-sim-venv"]))
  && run(py, ["-m", "pip", "install", "--no-cache-dir", "-q", "-r", "fs_sim/requirements.txt"])
  && run("bash", ["fs_sim/fetch_std.sh"]);
console.log(ok ? "[fs_sim setup] simulator ready" : "[fs_sim setup] failed; the site will run without the simulator");
process.exit(0);
