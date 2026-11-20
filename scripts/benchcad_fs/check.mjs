// Builds every converted BenchCAD part (scripts/benchcad_fs/convert.py output) in the local
// FS-Lite build and compares it with CadQuery's own measurement (data/benchcad_reference.json).
//   node scripts/benchcad_fs/check.mjs <dir>        -> <dir>/check.json + a summary
// A part passes when its volume is within 1.5 % and its size within 0.5 mm of the original.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2];
const root = new URL("../../", import.meta.url);
const reference = JSON.parse(readFileSync(new URL("data/benchcad_reference.json", root), "utf8"));
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const python = fileURLToPath(new URL(".fsgen/venv/Scripts/python.exe", root));
const script = fileURLToPath(new URL("scripts/local_build.py", root));

const results = {};
const entries = Object.entries(index).filter(([, v]) => v.file);
for (let i = 0; i < entries.length; i += 20) {
  const batch = entries.slice(i, i + 20);
  let out = "";
  try {
    out = execFileSync(python, [script, ...batch.map(([, v]) => join(dir, v.file))], { encoding: "utf8", timeout: 600000, maxBuffer: 1 << 26 });
  } catch (err) {
    out = String(err.stdout || "");
  }
  const lines = out.split("\n").filter(line => line.startsWith("{"));
  for (const [key, v] of batch) {
    const line = lines.find(l => JSON.parse(l).file === v.file);
    const built = line ? JSON.parse(line) : { ok: null, error: "no result" };
    const ref = reference[key];
    const m = built.metrics || {};
    let verdict = "fail";
    let why = built.error || "";
    if (built.ok === true && ref?.volume_mm3) {
      const volErr = Math.abs(m.volume_mm3 - ref.volume_mm3) / Math.max(1e-9, ref.volume_mm3);
      const size = b => [b[3] - b[0], b[4] - b[1], b[5] - b[2]].sort((x, y) => x - y);
      const sizeErr = Math.max(...size(m.bbox_mm).map((s, k) => Math.abs(s - size(ref.bbox_mm)[k])));
      verdict = volErr <= 0.015 && sizeErr <= 0.5 && m.bodies === ref.bodies ? "pass" : "mismatch";
      why = `volume ${(volErr * 100).toFixed(2)}% off, size ${sizeErr.toFixed(2)} mm off, bodies ${m.bodies}/${ref.bodies}`;
    } else if (built.ok === null) {
      verdict = "unchecked";
    }
    results[key] = { family: v.family, verdict, why };
  }
  process.stdout.write(`\r${Math.min(i + 20, entries.length)}/${entries.length}`);
}
writeFileSync(join(dir, "check.json"), JSON.stringify(results, null, 1));
const tally = {};
for (const r of Object.values(results)) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log(`\n${JSON.stringify(tally)}  (${new Set(Object.values(results).filter(r => r.verdict === "pass").map(r => r.family)).size} families pass)`);
