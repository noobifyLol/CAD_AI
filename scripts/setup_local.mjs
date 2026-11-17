// One-command setup to run CAD AI on your own computer with both build checkers local
// (faster than the cloud, and no cloud credits):   npm install && npm run setup && npm start
//
// It installs, inside this folder only (all git-ignored):
//   .fsgen/venv            a Python environment with the CAD kernel (build123d / OpenCascade)
//   .fsgen/onshape-fsgen   the FS-Lite test builder (MIT, github.com/Lucasfrit/onshape-fsgen)
//   fs_sim/std             Onshape's FeatureScript standard library (MIT) for the simulator
// and creates .env from .env.example if you do not have one. Safe to run again: finished
// steps are skipped. Needs Python 3.10+ and git.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (...parts) => path.join(ROOT, ...parts);
const FSGEN_COMMIT = "eabcc02ba104005da3de869e613cefe53042fd98";
const STD_COMMIT = "a2a7b13ea823f144b20d27198043aea35a64d928"; // Onshape std v2960, as in fs_sim/fetch_std.sh
const windows = process.platform === "win32";
const venvPython = windows ? at(".fsgen", "venv", "Scripts", "python.exe") : at(".fsgen", "venv", "bin", "python");

const run = (cmd, args, cwd = ROOT) => spawnSync(cmd, args, { cwd, stdio: "inherit" }).status === 0;
const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
const step = message => console.log(`\n== ${message}`);
const fail = message => { console.error(`\nSetup stopped: ${message}`); process.exit(1); };

// 1) tools
if (quiet("git", ["--version"]).status !== 0) fail("git is not installed (https://git-scm.com/downloads).");
const python = [["py", ["-3"]], ["python3", []], ["python", []]].map(([cmd, pre]) => {
  const out = quiet(cmd, [...pre, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"]);
  const [major, minor] = String(out.stdout || "").trim().split(" ").map(Number);
  return out.status === 0 && major === 3 && minor >= 10 ? { cmd, pre } : null;
}).find(Boolean);
if (!python && !existsSync(venvPython)) fail("Python 3.10 or newer was not found (https://www.python.org/downloads/).");

// 2) Python environment with the CAD kernel
step("Python environment (.fsgen/venv)");
if (existsSync(venvPython)) console.log("already there");
else {
  mkdirSync(at(".fsgen"), { recursive: true });
  if (!run(python.cmd, [...python.pre, "-m", "venv", at(".fsgen", "venv")])) fail("could not create the Python environment.");
}
const hasKernel = quiet(venvPython, ["-c", "import OCP, build123d, matplotlib, numpy"]).status === 0;
if (hasKernel) console.log("CAD kernel already installed");
else {
  console.log("installing the CAD kernel (about 300 MB, a few minutes) ...");
  if (!run(venvPython, ["-m", "pip", "install", "--quiet", "build123d", "matplotlib", "numpy"])) fail("pip could not install the CAD kernel.");
}

// 3) FS-Lite test builder
step("FS-Lite test builder (.fsgen/onshape-fsgen)");
if (existsSync(at(".fsgen", "onshape-fsgen", "fsgen"))) console.log("already there");
else if (!(run("git", ["clone", "--quiet", "https://github.com/Lucasfrit/onshape-fsgen", at(".fsgen", "onshape-fsgen")])
  && run("git", ["checkout", "--quiet", FSGEN_COMMIT], at(".fsgen", "onshape-fsgen")))) fail("could not download onshape-fsgen.");

// 4) Onshape standard library for the simulator
step("Onshape standard library (fs_sim/std)");
if (existsSync(at("fs_sim", "std", "geometry.fs"))) console.log("already there");
else {
  rmSync(at("fs_sim", "std"), { recursive: true, force: true });
  mkdirSync(at("fs_sim", "std"), { recursive: true });
  const std = at("fs_sim", "std");
  const ok = run("git", ["init", "--quiet"], std)
    && run("git", ["remote", "add", "origin", "https://github.com/javawizard/onshape-std-library-mirror"], std)
    && run("git", ["fetch", "--quiet", "--depth", "1", "origin", STD_COMMIT], std)
    && run("git", ["checkout", "--quiet", "FETCH_HEAD"], std);
  if (!ok) fail("could not download the Onshape standard library.");
}

// 5) settings file
step("Settings (.env)");
if (existsSync(at(".env"))) console.log("already there");
else {
  copyFileSync(at(".env.example"), at(".env"));
  console.log("created .env from .env.example");
}
const env = readFileSync(at(".env"), "utf8");
const hasKey = /^(GROQ_API_KEY\d*|ALT_LLM_API_KEY(_\d)?)=\S+/m.test(env);

// 6) self-test: build one library part with both checkers
step("Self-test");
const test = quiet(process.execPath, ["--input-type=module", "-e", `
  import { readFileSync } from "node:fs";
  const { localBuildFeatureScript } = await import("./localBuild.js");
  const { simulateFeatureScript } = await import("./simulatorClient.js");
  const code = readFileSync("data/fs_examples/flat_washer.fs", "utf8");
  const build = await localBuildFeatureScript(code);
  const sim = await simulateFeatureScript(code);
  console.log(build.ok === true && sim.builds === true ? "CHECKERS_OK" : "CHECKERS_FAILED " + JSON.stringify({ build: build.ok, reason: build.skippedReason || build.error, sim: sim.builds ?? sim.reason }));
  process.exit(0);
`]);
const passed = String(test.stdout || "").includes("CHECKERS_OK");
console.log(passed ? "both build checkers work on this computer" : `the checkers did not pass: ${String(test.stdout || test.stderr).trim().split("\n").pop()}`);

console.log(`\n${passed ? "Setup finished." : "Setup finished with a problem (see above)."}`);
if (!hasKey) console.log("Next: open .env and paste a free AI key (Gemini: https://aistudio.google.com/apikey  or Groq: https://console.groq.com/keys).");
console.log("Then run:  npm start   and open http://localhost:10000");
process.exit(passed ? 0 : 1);
