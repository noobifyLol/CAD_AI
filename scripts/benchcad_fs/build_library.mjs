// Packs every BenchCAD conversion that passed check.mjs into data/benchcad_fs.json.gz, the
// standard-part library the site returns for prompts that name one of these parts.
//   .cq-venv/Scripts/python scripts/benchcad_fs/convert.py <dir>
//   node scripts/benchcad_fs/check.mjs <dir>
//   node scripts/benchcad_fs/build_library.mjs <dir>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const dir = process.argv[2];
const root = new URL("../../", import.meta.url);
const refs = JSON.parse(gunzipSync(readFileSync(new URL("data/benchcad_refs.json.gz", root)))).refs;
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const check = JSON.parse(readFileSync(join(dir, "check.json"), "utf8"));

const parts = [];
for (const [key, entry] of Object.entries(index)) {
  if (!entry.file || check[key]?.verdict !== "pass") continue;
  const ref = refs[Number(key.split("#")[1])];
  parts.push({
    family: entry.family,
    variant: ref.variant || "standard",
    difficulty: ref.difficulty || "",
    standard: ref.standard || "",
    ops: entry.ops,
    code: readFileSync(join(dir, entry.file), "utf8").replace(/\r\n/g, "\n"),
  });
}
const out = new URL("data/benchcad_fs.json.gz", root);
writeFileSync(out, gzipSync(JSON.stringify({
  source: "BenchCAD (CC-BY 4.0, https://huggingface.co/datasets/BenchCAD/BenchCAD), converted from CadQuery by scripts/benchcad_fs; every part matches CadQuery's volume within 1.5 %",
  parts,
}), { level: 9 }));
console.log(`${parts.length} parts from ${new Set(parts.map(p => p.family)).size} families -> data/benchcad_fs.json.gz (${Math.round(readFileSync(out).length / 1024)} KB)`);
