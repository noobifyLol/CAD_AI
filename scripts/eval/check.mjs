// Batch test, step 2: build every .fs in a folder with both checkers (FS-Lite test build
// and the Onshape-library simulator) and print which ones resolve.
//   node scripts/eval/check.mjs <dir> [--fix]    --fix runs the site's automatic repairs first
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { localBuildFeatureScript } from "../../localBuild.js";
import { simulateFeatureScript } from "../../simulatorClient.js";

const [dir, flag] = process.argv.slice(2);
const fix = flag === "--fix";
const { validateFeatureScriptStrict } = fix ? await import("../../ai.js") : {};
let ok = 0, total = 0;
for (const file of readdirSync(dir).filter(name => /^\d.*\.fs$/.test(name)).sort()) {
  let code = readFileSync(`${dir}/${file}`, "utf8");
  if (fix) {
    code = validateFeatureScriptStrict(code).code;
    writeFileSync(`${dir}/fixed_${file}`, code);
  }
  const local = await localBuildFeatureScript(code);
  const sim = await simulateFeatureScript(code);
  const simOk = sim.builds || (sim.gaps?.length && !sim.errors?.length) || !sim.available;
  const good = local.ok !== false && simOk && (local.ok === true || sim.builds);
  total += 1;
  if (good) ok += 1;
  const faces = (sim.parts || []).reduce((sum, part) => sum + (part.faces || 0), 0);
  console.log(`${good ? "OK  " : "FAIL"} ${file.padEnd(38)} ${local.metrics ? `bodies=${local.metrics.bodies} ` : ""}faces=${faces} `
    + `${String(local.error || "").slice(0, 90)}${local.error && sim.errors?.[0] ? " | " : ""}${String(sim.errors?.[0] || "").slice(0, 90)}`);
}
console.log(`${ok}/${total} resolve`);
process.exit(0);
