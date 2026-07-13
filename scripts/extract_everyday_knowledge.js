// Second extraction pass over the kept Omni-CAD caption corpus
// (data/Omni-CAD/txt), focused on EVERYDAY ITEMS. Produces retrieval rows in
// data/cadDatasetSummaries.json that map everyday-object language to the
// FeatureScript build strategy the generator should use.
//
// Usage: node scripts/extract_everyday_knowledge.js
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OMNI_TXT_DIR = join(ROOT, "data", "Omni-CAD", "txt");
const SUMMARY_PATH = join(ROOT, "data", "cadDatasetSummaries.json");

const EVERYDAY_BUCKETS = [
  { key: "pen_writing", label: "Pens And Writing Tools", pattern: /\b(pen|pencil|marker|stylus|crayon)\b/i, keywords: ["pen", "pencil", "marker", "stylus", "writing"], strategy: "Barrel cylinder + lofted tapered tip + thin pocket clip, unioned (see pen_with_tip_and_clip example)." },
  { key: "bottle_vessel", label: "Bottles And Vessels", pattern: /\b(bottle|jar|flask|jug|vase|vial|carafe)\b/i, keywords: ["bottle", "jar", "flask", "vase", "container", "neck"], strategy: "Revolve a belly-shoulder-neck profile around an axis line, then opShell hollow through the neck (see bottle_with_neck example)." },
  { key: "cup_mug", label: "Cups And Mugs", pattern: /\b(cup|mug|tumbler|glass|bowl|dish)\b/i, keywords: ["cup", "mug", "bowl", "handle", "drink"], strategy: "Shelled cylinder wall + ring handle on a perpendicular plane, unioned (see cup_with_handle example)." },
  { key: "wheel_rotary", label: "Wheels And Rotary Parts", pattern: /\b(wheel|pulley|caster|roller|hub|axle|tire)\b/i, keywords: ["wheel", "pulley", "hub", "axle", "spokes", "rim"], strategy: "Rim ring + hub ring with axle bore + one spoke patterned with opPattern rotationAround transforms (see wheel_with_spokes example)." },
  { key: "fastener", label: "Fasteners And Hardware", pattern: /\b(bolt|screw|nut|washer|fastener|rivet|stud)\b/i, keywords: ["bolt", "screw", "nut", "washer", "fastener", "hex"], strategy: "Hex head via skRegularPolygon + shaft cylinder + union + tip chamfer (see hex_bolt example); washers are concentric-circle rings." },
  { key: "furniture", label: "Furniture Shapes", pattern: /\b(table|chair|desk|stool|shelf|bench|leg)\b/i, keywords: ["table", "chair", "desk", "legs", "shelf", "furniture"], strategy: "Top slab extrude + legs positioned in one sketch or patterned, unioned (see multi_body_union example)." },
  { key: "handle_grip", label: "Handles Knobs And Grips", pattern: /\b(handle|knob|grip|lever|crank)\b/i, keywords: ["handle", "knob", "grip", "lever", "crank"], strategy: "Swept or revolved profile for grips; knobs are revolves with filleted edges (see swept_tube and revolved_vase examples)." },
  { key: "frame_border", label: "Frames And Borders", pattern: /\b(frame|border|bezel|rim|outline|window)\b/i, keywords: ["frame", "border", "bezel", "window", "outline"], strategy: "Outer and inner rectangles in the SAME sketch extrude into a rectangular ring (see picture_frame example)." },
  { key: "hook_hanger", label: "Hooks And Hangers", pattern: /\b(hook|hanger|hang|peg board|coat)\b/i, keywords: ["hook", "hanger", "peg", "coat", "curved"], strategy: "Sweep a circular profile along an open J-shaped spline path (see swept_tube example)." },
  { key: "tool_utensil", label: "Tools And Utensils", pattern: /\b(spoon|fork|knife|hammer|wrench|screwdriver|spatula|tool)\b/i, keywords: ["tool", "spoon", "hammer", "wrench", "utensil", "handle"], strategy: "Handle (cylinder or swept profile) + working end as its own body, unioned; keep both editable." },
];

if (!existsSync(OMNI_TXT_DIR)) {
  console.error("[everyday] Caption corpus not found at data/Omni-CAD/txt — nothing to extract.");
  process.exit(1);
}

const stats = Object.fromEntries(EVERYDAY_BUCKETS.map(b => [b.key, { count: 0, samples: [] }]));
let totalCaptions = 0;

for (const txtFile of readdirSync(OMNI_TXT_DIR).filter(f => f.endsWith(".json"))) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(OMNI_TXT_DIR, txtFile), "utf8"));
  } catch {
    continue;
  }
  for (const row of rows) {
    const caption = String(row?.["text caption"] || "");
    if (!caption) continue;
    totalCaptions += 1;
    for (const bucket of EVERYDAY_BUCKETS) {
      if (!bucket.pattern.test(caption)) continue;
      const bucketStats = stats[bucket.key];
      bucketStats.count += 1;
      if (bucketStats.samples.length < 2) bucketStats.samples.push(caption.slice(0, 200));
    }
  }
}

console.log(`[everyday] Scanned ${totalCaptions} captions.`);
const newRows = EVERYDAY_BUCKETS.filter(b => stats[b.key].count > 0).map(bucket => ({
  title: `Omni-CAD Everyday ${bucket.label}`,
  summary: `${stats[bucket.key].count} Omni-CAD captions describe ${bucket.label.toLowerCase()}. Example: ${stats[bucket.key].samples[0] || ""}`,
  tags: ["dataset", "omni-cad", "everyday", bucket.key],
  keywords: bucket.keywords,
  parameter_hints: [],
  modeling_notes: [bucket.strategy],
  source_table: "dataset_summaries",
  memory_type: "dataset_summary",
}));
for (const bucket of EVERYDAY_BUCKETS) {
  console.log(`  ${bucket.key}: ${stats[bucket.key].count} captions`);
}

let existing = [];
try {
  const parsed = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
  existing = Array.isArray(parsed) ? parsed : (parsed.rows || []);
} catch { /* start fresh */ }

const newTitles = new Set(newRows.map(row => row.title));
const merged = [...existing.filter(row => !newTitles.has(String(row.title || ""))), ...newRows];
writeFileSync(SUMMARY_PATH, JSON.stringify(merged, null, 2));
console.log(`[everyday] Wrote ${merged.length} total rows to ${SUMMARY_PATH} (${newRows.length} everyday rows).`);
