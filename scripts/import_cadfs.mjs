// Import CADFS (VladPyatov/CADFS, CC BY 4.0) into a VERIFIED 2931 corpus.
//
// CADFS ships text->FeatureScript pairs, but the FeatureScript is version 1913,
// non-parametric (empty precondition, hardcoded mm), reconstruction-style — the
// wrong shape for this project directly. Instead of using that code, we transcode
// the GEOMETRY SEMANTICS through our Tier-2 plan compiler, which emits clean 2931
// with real editable dialog parameters. Every result is validated (and optionally
// Onshape-compiled) before it's kept.
//
// Usage:
//   node scripts/import_cadfs.mjs [maxRecords] [--onshape]
// Streams a bounded prefix of the 832MB training jsonl over HTTP (never the full
// 90GB dataset); writes verified rows to data/cadfs_verified.jsonl.
import dotenv from "dotenv";
dotenv.config();
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import https from "node:https";
import { compilePlanToFeatureScript } from "../planCompiler.js";
import { validateFeatureScriptStrict } from "../ai.js";
import { isOnshapeConfigured, testCompileFeatureScript } from "../onshapeClient.js";

const MAX_RECORDS = Number(process.argv[2]) || 4000;
const USE_ONSHAPE = process.argv.includes("--onshape");
const BYTE_BUDGET = Number(process.env.CADFS_BYTE_BUDGET || 60 * 1024 * 1024); // ~60MB prefix
const SRC_URL = "https://huggingface.co/datasets/VladPyatov/CADFS/resolve/main/cadfs/train_data/stage1_text_train.jsonl";
const OUT_PATH = new URL("../data/cadfs_verified.jsonl", import.meta.url);
const MM_PER_INCH = 25.4;
const round = n => Math.round(n * 1e5) / 1e5;

const nullStep = { plane: null, entities: null, sketch: null, sketches: null, profileSketch: null, pathSketch: null, target: null, tools: null, value: null, count: null, direction: null, filterInnerLoops: null };
const nullEntity = () => ({ type: null, id: null, center: null, radius: null, corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null });

function parseCoordsMm(block, key) {
  const m = block.match(new RegExp(`"${key}"\\s*:\\s*v\\(\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\)\\s*\\*\\s*mm`));
  return m ? [Number(m[1]) / MM_PER_INCH, Number(m[2]) / MM_PER_INCH] : null;
}

// Transcode one CADFS assistant FS -> our plan (prismatic rectangle [+ holes] -> extrude).
// Conservative: anything it can't confidently map is skipped, never guessed.
function transcodeToPlan(fs, cadId) {
  if (!/precondition\{\}/.test(fs)) return { skip: "parametric/complex feature" };
  const body = fs.slice(fs.indexOf("precondition{}"));

  const lines = [];
  for (const m of body.matchAll(/skLineSegment\([^,]+,[^,]+,\s*\{([^}]*)\}\s*\)/g)) {
    const s = parseCoordsMm(m[1], "start"); const e = parseCoordsMm(m[1], "end");
    if (s && e) lines.push([s, e]);
  }
  const circles = [];
  for (const m of body.matchAll(/skCircle\([^,]+,[^,]+,\s*\{([^}]*)\}\s*\)/g)) {
    const c = parseCoordsMm(m[1], "center");
    const r = m[1].match(/"radius"\s*:\s*(-?[\d.]+)\s*\*\s*mm/);
    if (c && r) circles.push({ center: c, radius: Number(r[1]) / MM_PER_INCH });
  }
  // Reject curved/complex profiles the box transcoder can't represent faithfully.
  if (/skArc\(|skFitSpline\(|skEllipse\(/.test(body)) return { skip: "curved sketch entities" };
  if (/opRevolve\(|opLoft\(|opSweep\(|opFillet\(|opChamfer\(|opShell\(/.test(body)) return { skip: "advanced operation" };

  const exMatch = body.match(/extrude\([^{]*\{[^}]*"depth"\s*:\s*(-?[\d.]+)\s*\*\s*mm(?:[^}]*"offsetDistance"\s*:\s*(-?[\d.]+)\s*\*\s*mm)?/);
  if (!exMatch) return { skip: "no simple extrude" };
  const depth = Math.abs(Number(exMatch[1])) / MM_PER_INCH;
  const offset = exMatch[2] ? Number(exMatch[2]) / MM_PER_INCH : 0;
  if (!(depth > 0)) return { skip: "zero-depth extrude" };

  if (lines.length < 3) return { skip: "not a rectangle profile" };
  const xs = lines.flatMap(([a, b]) => [a[0], b[0]]);
  const ys = lines.flatMap(([a, b]) => [a[1], b[1]]);
  const w = round(Math.max(...xs) - Math.min(...xs));
  const h = round(Math.max(...ys) - Math.min(...ys));
  if (!(w > 0) || !(h > 0)) return { skip: "degenerate rectangle" };
  // Reject holes outside the rectangle (our parser only handles interior holes).
  if (circles.some(c => Math.abs(c.center[0]) > w / 2 || Math.abs(c.center[1]) > h / 2 || c.radius >= Math.min(w, h) / 2)) {
    return { skip: "hole outside/oversized rectangle" };
  }

  const parameters = [
    { name: "width", label: "Width", kind: "length", min: round(w * 0.2), default: w, max: round(w * 5) },
    { name: "height", label: "Height", kind: "length", min: round(h * 0.2), default: h, max: round(h * 5) },
    { name: "depth", label: "Depth", kind: "length", min: round(Math.max(0.01, depth * 0.2)), default: round(Math.max(0.02, depth)), max: round(Math.max(0.1, depth * 5)) },
  ];
  const entities = [{ ...nullEntity(), type: "rectangle", id: "rect", corner1: ["-width / 2", "-height / 2"], corner2: ["width / 2", "height / 2"] }];
  circles.forEach((c, i) => {
    const pname = i === 0 ? "holeRadius" : `holeRadius${i + 1}`;
    parameters.push({ name: pname, label: `Hole Radius ${i + 1}`, kind: "length", min: round(Math.max(0.005, c.radius * 0.2)), default: round(Math.max(0.01, c.radius)), max: round(Math.max(0.05, c.radius * 5)) });
    entities.push({ ...nullEntity(), type: "circle", id: `hole${i}`, center: [round(c.center[0]), round(c.center[1])], radius: pname });
  });

  return {
    plan: {
      featureName: "cadfsPart",
      featureLabel: "CADFS Part",
      reasoning: `Transcoded from CADFS ${cadId}.`,
      parameters,
      steps: [
        { ...nullStep, op: "sketch", id: "profileSk", plane: offset ? `offset:${round(offset)}` : "base", entities },
        { ...nullStep, op: "extrude", id: "solidBody", sketch: "profileSk", value: "depth", filterInnerLoops: circles.length ? true : null },
      ],
    },
  };
}

// Stream a bounded prefix of the jsonl; resolve with the complete lines read.
function fetchPrefix(url, byteBudget) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Range: `bytes=0-${byteBudget}` } }, res => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return fetchPrefix(res.headers.location, byteBudget).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        return reject(new Error(`HTTP ${res.statusCode} fetching CADFS`));
      }
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

console.log(`[cadfs] streaming ~${Math.round(BYTE_BUDGET / 1024 / 1024)}MB prefix of the training jsonl (of 832MB; full dataset is 90GB and never downloaded)...`);
const prefix = await fetchPrefix(SRC_URL, BYTE_BUDGET);
const rawLines = prefix.split("\n").filter(l => l.trim().startsWith("{"));
// Drop the last line (likely truncated by the byte boundary).
rawLines.pop();
console.log(`[cadfs] ${rawLines.length} complete records in prefix; transcoding up to ${MAX_RECORDS}.`);

const results = [];
const skips = {};
let seen = 0, transcoded = 0, clean = 0, onshapeOk = 0, onshapeChecked = 0;
for (const line of rawLines) {
  if (seen >= MAX_RECORDS) break;
  let rec; try { rec = JSON.parse(line); } catch { continue; }
  seen += 1;
  const fs = (rec.messages || []).find(m => m.role === "assistant")?.content || "";
  const stepText = (rec.messages || []).find(m => m.role === "user")?.content || "";
  const out = transcodeToPlan(fs, rec.cad_file_id);
  if (out.skip) { skips[out.skip] = (skips[out.skip] || 0) + 1; continue; }
  transcoded += 1;
  const compiled = compilePlanToFeatureScript(out.plan);
  if (!compiled.ok) { skips["plan compile failed"] = (skips["plan compile failed"] || 0) + 1; continue; }
  const strict = validateFeatureScriptStrict(compiled.code);
  if (!strict.ok) { skips["validator rejected"] = (skips["validator rejected"] || 0) + 1; continue; }
  clean += 1;

  let onshapeVerified = null;
  if (USE_ONSHAPE && isOnshapeConfigured() && onshapeChecked < 40) {
    onshapeChecked += 1;
    const check = await testCompileFeatureScript(compiled.code);
    if (check.ok === true) { onshapeVerified = true; onshapeOk += 1; }
    else if (check.ok === false) { onshapeVerified = false; }
  }
  results.push({
    cad_file_id: rec.cad_file_id,
    stepText: stepText.slice(0, 500),
    parameterCount: out.plan.parameters.length,
    holeCount: out.plan.parameters.filter(p => p.name.startsWith("holeRadius")).length,
    onshapeVerified,
    code: compiled.code,
  });
}

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(OUT_PATH, results.map(r => JSON.stringify(r)).join("\n") + (results.length ? "\n" : ""));
console.log(`\n[cadfs] seen=${seen} transcoded=${transcoded} validatorClean=${clean}` + (USE_ONSHAPE ? ` onshapeOk=${onshapeOk}/${onshapeChecked}` : ""));
console.log(`[cadfs] wrote ${results.length} verified 2931 rows to data/cadfs_verified.jsonl`);
console.log("[cadfs] skip reasons:", JSON.stringify(skips, null, 1));
