// One-time extraction of retrieval knowledge from the raw Omni-CAD / DeepCAD
// datasets BEFORE the extracted archives are removed.
//
// Produces:
//   1. data/cadDatasetSummaries.json  — refreshed bucket summary rows (merged)
//   2. data/captionGeometryPairs.json — caption -> operation-profile pairs the
//      generator can retrieve at prompt time (language -> CAD ops grounding)
//
// Usage: node scripts/extract_dataset_knowledge.js
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OMNI_TXT_DIR = join(ROOT, "data", "Omni-CAD", "txt");
const OMNI_JSON_DIR = join(ROOT, "data", "Omni-CAD", "json");
const DEEPCAD_JSON_DIR = join(ROOT, "data", "data", "cad_json");
const SUMMARY_PATH = join(ROOT, "data", "cadDatasetSummaries.json");
const PAIRS_PATH = join(ROOT, "data", "captionGeometryPairs.json");

const BUCKETS = [
  { key: "hole_plate", label: "Plates And Holes", pattern: /\b(hole|holes|perforat|drilled|bore)\b/i, keywords: ["plate", "hole", "holes", "mount", "bracket", "bore", "drill"], note: "Cut holes with same-sketch inner circles (qSketchRegion filterInnerLoops) or opBoolean SUBTRACTION of an extruded hole tool." },
  { key: "cylinder", label: "Cylinders And Shafts", pattern: /\b(cylinder|cylindrical|shaft|rod|tube|tubular)\b/i, keywords: ["cylinder", "shaft", "rod", "tube", "round", "circular"], note: "Sketch circle + opExtrude is the robust cylinder path; stack sections on offset planes and union for stepped shafts." },
  { key: "hollow_shell", label: "Hollow And Shelled Parts", pattern: /\b(hollow|hollowed|shell|cavity|interior|open box|open top)\b/i, keywords: ["hollow", "shell", "container", "box", "cavity", "wall"], note: "Make the solid first, then opShell with negative thickness; pass the cap face to open a side." },
  { key: "ring_washer", label: "Rings And Washers", pattern: /\b(ring|washer|annular|donut|torus|concentric)\b/i, keywords: ["ring", "washer", "spacer", "annular", "concentric", "bore"], note: "Two concentric circles in ONE sketch extrude directly into a ring; no boolean needed." },
  { key: "frame_beam", label: "Frames And Beams", pattern: /\b(frame|beam|bar|rail|truss|interlock|elongated)\b/i, keywords: ["frame", "beam", "bar", "rail", "structure", "elongated"], note: "Closed polyline profiles extruded per member; union members with opBoolean." },
  { key: "curved_organic", label: "Curved And Organic Forms", pattern: /\b(curved|curve|arc|rounded|smooth|organic|taper(?:ed|ing)?|cone|conical)\b/i, keywords: ["curved", "rounded", "smooth", "taper", "cone", "organic", "arc"], note: "Tapered/organic bodies revolve a closed spline profile (axis line + skFitSpline + closing lines) around a Line axis." },
  { key: "gear_tooth", label: "Gears And Teeth", pattern: /\b(gear|teeth|tooth|sprocket|cog)\b/i, keywords: ["gear", "teeth", "tooth", "sprocket", "cog"], note: "Real gears need involute flank splines with root/tip arcs and a circular pattern, never bare concentric circles." },
  { key: "bracket_mount", label: "Brackets And Mounts", pattern: /\b(bracket|mount|mounting|flange|support|base plate)\b/i, keywords: ["bracket", "mount", "flange", "support", "base"], note: "L/U profiles as closed polylines, one extrude, holes cut after; fillet edges via qEdgeTopologyFilter." },
  { key: "pattern_symmetric", label: "Patterned And Symmetric Features", pattern: /\b(symmetric|symmetrical|pattern|evenly spaced|array of|repeated)\b/i, keywords: ["pattern", "symmetric", "spaced", "array", "repeated", "circular"], note: "Place repeated features with a for-loop over trig positions in ONE sketch; string ids use the ~ operator." },
  { key: "box_prism", label: "Boxes And Prisms", pattern: /\b(rectangular prism|box|cube|block|slab)\b/i, keywords: ["box", "cube", "block", "prism", "rectangular", "slab"], note: "skRectangle + opExtrude; hollow variants shell afterwards." },
];

const PAIRS_PER_BUCKET = 60;
const CAPTION_TRIM = 300;
const DEEPCAD_SAMPLE_TARGET = 3000;

function listJsonFiles(dir, limit) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const current = stack.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (out.length >= limit) break;
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".json")) out.push(full);
    }
  }
  return out;
}

// ── Geometry profiling for one Omni-CAD/DeepCAD entity JSON ─────────────────
function profileGeometry(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  const counts = { sketches: 0, extrudes: 0, revolves: 0, otherFeatures: 0, lines: 0, arcs: 0, circles: 0, splines: 0, profiles: 0, cutOps: 0, joinOps: 0 };
  const entities = parsed?.entities || {};
  for (const entity of Object.values(entities)) {
    const type = String(entity?.type || "");
    if (type === "Sketch") {
      counts.sketches += 1;
      for (const profile of Object.values(entity.profiles || {})) {
        counts.profiles += 1;
        for (const loop of profile.loops || []) {
          for (const curve of loop.profile_curves || []) {
            const curveType = String(curve?.type || "");
            if (curveType.startsWith("Line")) counts.lines += 1;
            else if (curveType.startsWith("Arc")) counts.arcs += 1;
            else if (curveType.startsWith("Circle")) counts.circles += 1;
            else counts.splines += 1;
          }
        }
      }
    } else if (/Extrude/i.test(type)) {
      counts.extrudes += 1;
      const op = String(entity?.operation || "");
      if (/cut/i.test(op)) counts.cutOps += 1;
      if (/join|new/i.test(op)) counts.joinOps += 1;
    } else if (/Revolve/i.test(type)) {
      counts.revolves += 1;
    } else if (type) {
      counts.otherFeatures += 1;
    }
  }
  return counts;
}

function summarizeCounts(counts) {
  const parts = [];
  if (counts.sketches) parts.push(`${counts.sketches} sketch(es)`);
  if (counts.extrudes) parts.push(`${counts.extrudes} extrude(s)`);
  if (counts.revolves) parts.push(`${counts.revolves} revolve(s)`);
  if (counts.cutOps) parts.push(`${counts.cutOps} cut op(s)`);
  const curves = [];
  if (counts.lines) curves.push(`${counts.lines} lines`);
  if (counts.arcs) curves.push(`${counts.arcs} arcs`);
  if (counts.circles) curves.push(`${counts.circles} circles`);
  if (counts.splines) curves.push(`${counts.splines} splines`);
  if (curves.length) parts.push(`curves: ${curves.join(", ")}`);
  return parts.join("; ");
}

// ── Pass 1: captions → buckets + caption/geometry pairs ─────────────────────
console.log("[extract] Scanning Omni-CAD captions...");
const bucketStats = Object.fromEntries(BUCKETS.map(b => [b.key, { count: 0, samples: [], pairs: [] }]));
let totalCaptions = 0;

const txtFiles = existsSync(OMNI_TXT_DIR) ? readdirSync(OMNI_TXT_DIR).filter(f => f.endsWith(".json")) : [];
for (const txtFile of txtFiles) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(OMNI_TXT_DIR, txtFile), "utf8"));
  } catch {
    continue;
  }
  for (const row of rows) {
    const caption = String(row?.["text caption"] || "");
    const id = String(row?.id || "");
    if (!caption || !id) continue;
    totalCaptions += 1;
    for (const bucket of BUCKETS) {
      if (!bucket.pattern.test(caption)) continue;
      const stats = bucketStats[bucket.key];
      stats.count += 1;
      if (stats.samples.length < 2) stats.samples.push(caption.slice(0, 220));
      // Reservoir-lite: take early matches spread across files.
      if (stats.pairs.length < PAIRS_PER_BUCKET && stats.count % 7 === 1) {
        stats.pairs.push({ id, caption: caption.slice(0, CAPTION_TRIM) });
      }
    }
  }
}
console.log(`[extract] ${totalCaptions} captions scanned across ${txtFiles.length} files.`);
for (const bucket of BUCKETS) {
  console.log(`  ${bucket.key}: ${bucketStats[bucket.key].count} captions, ${bucketStats[bucket.key].pairs.length} pair candidates`);
}

// ── Pass 2: resolve pair geometry from Omni-CAD json ────────────────────────
console.log("[extract] Profiling geometry for caption pairs...");
const pairs = [];
for (const bucket of BUCKETS) {
  for (const candidate of bucketStats[bucket.key].pairs) {
    const jsonPath = join(OMNI_JSON_DIR, `${candidate.id}.json`);
    if (!existsSync(jsonPath)) continue;
    const counts = profileGeometry(jsonPath);
    if (!counts || (!counts.extrudes && !counts.revolves)) continue;
    pairs.push({
      title: `Omni-CAD ${bucket.label} ${candidate.id}`,
      summary: `${candidate.caption} => Built with ${summarizeCounts(counts)}.`,
      tags: ["dataset", "omni-cad", bucket.key],
      keywords: bucket.keywords,
      parameter_hints: [],
      modeling_notes: [BUCKETS.find(b => b.key === bucket.key).note],
      source_table: "omni_caption_pairs",
      memory_type: "dataset_pair",
      bucket: bucket.key,
      geometry: counts,
    });
  }
}
console.log(`[extract] ${pairs.length} caption-geometry pairs resolved.`);

// ── Pass 3: DeepCAD operation statistics ────────────────────────────────────
console.log("[extract] Sampling DeepCAD cad_json operation statistics...");
const deepFiles = listJsonFiles(DEEPCAD_JSON_DIR, DEEPCAD_SAMPLE_TARGET);
const deepTotals = { files: 0, sketches: 0, extrudes: 0, revolves: 0, cutOps: 0, lines: 0, arcs: 0, circles: 0, splines: 0, multiSketch: 0 };
for (const filePath of deepFiles) {
  const counts = profileGeometry(filePath);
  if (!counts) continue;
  deepTotals.files += 1;
  deepTotals.sketches += counts.sketches;
  deepTotals.extrudes += counts.extrudes;
  deepTotals.revolves += counts.revolves;
  deepTotals.cutOps += counts.cutOps;
  deepTotals.lines += counts.lines;
  deepTotals.arcs += counts.arcs;
  deepTotals.circles += counts.circles;
  deepTotals.splines += counts.splines;
  if (counts.sketches > 1) deepTotals.multiSketch += 1;
}
console.log(`[extract] DeepCAD sample: ${JSON.stringify(deepTotals)}`);

// ── Write outputs ───────────────────────────────────────────────────────────
const bucketRows = BUCKETS.filter(b => bucketStats[b.key].count > 0).map(bucket => ({
  title: `Omni-CAD ${bucket.label} Captions`,
  summary: `${bucketStats[bucket.key].count} Omni-CAD captions describe ${bucket.label.toLowerCase()}. Example: ${bucketStats[bucket.key].samples[0] || ""}`,
  tags: ["dataset", "omni-cad", bucket.key],
  keywords: bucket.keywords,
  parameter_hints: [],
  modeling_notes: [bucket.note, "Derived from the full Omni-CAD caption corpus before archive removal."],
  source_table: "dataset_summaries",
  memory_type: "dataset_summary",
}));

const deepRows = deepTotals.files ? [{
  title: "DeepCAD Operation Frequency Profile",
  summary: `Sampled ${deepTotals.files} DeepCAD models: ${deepTotals.sketches} sketches, ${deepTotals.extrudes} extrudes, ${deepTotals.revolves} revolves, ${deepTotals.cutOps} cut operations; curves — ${deepTotals.lines} lines, ${deepTotals.arcs} arcs, ${deepTotals.circles} circles, ${deepTotals.splines} splines. ${deepTotals.multiSketch} models used multiple sketches.`,
  tags: ["dataset", "deepcad", "operations"],
  keywords: ["extrude", "sketch", "cut", "profile", "prismatic", "plate", "bracket"],
  parameter_hints: ["sketchCount", "extrudeCount", "cutRatio"],
  modeling_notes: [
    "Most real CAD models are 1-3 solved sketches each consumed by an extrude; cuts are common, so plan opBoolean SUBTRACTION for holes and pockets.",
    "Lines and circles dominate profiles; arcs and splines appear in curved/organic minorities.",
  ],
  source_table: "dataset_summaries",
  memory_type: "dataset_summary",
}] : [];

let existing = [];
try {
  const parsed = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
  existing = Array.isArray(parsed) ? parsed : (parsed.rows || []);
} catch { /* start fresh */ }

const newTitles = new Set([...bucketRows, ...deepRows].map(row => row.title));
const merged = [
  ...existing.filter(row => !newTitles.has(String(row.title || ""))),
  ...bucketRows,
  ...deepRows,
];
writeFileSync(SUMMARY_PATH, JSON.stringify(merged, null, 2));
console.log(`[extract] Wrote ${merged.length} rows to ${SUMMARY_PATH} (${bucketRows.length + deepRows.length} new/refreshed).`);

writeFileSync(PAIRS_PATH, JSON.stringify(pairs, null, 1));
console.log(`[extract] Wrote ${pairs.length} caption-geometry pairs to ${PAIRS_PATH}.`);
console.log("[extract] Done. The raw archives are no longer needed for retrieval.");
