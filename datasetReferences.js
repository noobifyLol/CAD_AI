/**
 * datasetReferences.js: real designs from the DeepCAD / Text2CAD part library (parts made by
 * people in Onshape; however many the installed data/deepcad_library_index.json.gz holds) as
 * reference recipes for the AI, for every request.
 *
 * For a prompt it finds the closest dataset parts, reads their actual construction steps
 * (sketch profiles, sizes, extrude depths, join/cut operations) and writes each as a short
 * readable recipe, scaled to inches. The AI adapts their structure and proportions instead
 * of inventing a design from nothing, so results get the detail real parts have.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { headNoun, readSequence, searchLibrary, tokenize } from "./deepcadLibrary.js";

const round = value => Math.round(value * 100) / 100;
const fmt = value => String(round(value));

function planeName(plane) {
  const n = plane?.normal || [0, 0, 1];
  const axis = n.map(Math.abs);
  const main = axis.indexOf(Math.max(...axis));
  const name = Math.max(...axis) > 0.99 ? ["side plane (YZ)", "front plane (XZ)", "top plane (XY)"][main] : "a tilted plane";
  const offset = (plane?.origin || [0, 0, 0]).reduce((sum, value, i) => sum + value * n[i], 0);
  return { name, offset };
}

function loopBounds(curves) {
  const pts = [];
  for (const c of curves) {
    if (c.type === "circle") {
      pts.push([c.center[0] - c.radius, c.center[1] - c.radius], [c.center[0] + c.radius, c.center[1] + c.radius]);
    } else {
      for (const key of ["start", "mid", "end"]) if (c[key]) pts.push(c[key]);
    }
  }
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function describeLoop(curves, scale) {
  const b = loopBounds(curves);
  const w = (b.maxX - b.minX) * scale;
  const h = (b.maxY - b.minY) * scale;
  const cx = ((b.minX + b.maxX) / 2) * scale;
  const cy = ((b.minY + b.maxY) / 2) * scale;
  if (curves.length === 1 && curves[0].type === "circle") {
    return `circle d=${fmt(curves[0].radius * 2 * scale)} at (${fmt(cx)}, ${fmt(cy)})`;
  }
  const lines = curves.filter(c => c.type === "line").length;
  const arcs = curves.length - lines;
  const axisAligned = curves.every(c => c.type !== "line" || Math.abs(c.start[0] - c.end[0]) < 1e-6 || Math.abs(c.start[1] - c.end[1]) < 1e-6);
  if (lines === 4 && arcs === 0 && axisAligned) return `rectangle ${fmt(w)} x ${fmt(h)} centered at (${fmt(cx)}, ${fmt(cy)})`;
  if (arcs === 4 && lines === 4) return `rounded rectangle ${fmt(w)} x ${fmt(h)} centered at (${fmt(cx)}, ${fmt(cy)})`;
  if (arcs === 2 && lines === 2) return `slot ${fmt(w)} x ${fmt(h)} centered at (${fmt(cx)}, ${fmt(cy)})`;
  if (lines >= 5 && arcs === 0 && axisAligned) return `L/U/T-shaped outline (${lines} straight edges) ${fmt(w)} x ${fmt(h)} centered at (${fmt(cx)}, ${fmt(cy)})`;
  return `outline of ${lines} lines and ${arcs} arcs, ${fmt(w)} x ${fmt(h)}, centered at (${fmt(cx)}, ${fmt(cy)})`;
}

/** Turns a cad-sequence/v1 into a short recipe (inches, largest size = targetSize). */
export function describeSequence(sequence, targetSize = 4) {
  const steps = sequence?.steps || [];
  if (!steps.length) return "";
  // Scale from the overall extent of all sketches and depths.
  let extent = 0;
  for (const step of steps) {
    for (const face of step.faces || []) for (const loop of face.loops || []) {
      const b = loopBounds(loop);
      extent = Math.max(extent, b.maxX - b.minX, b.maxY - b.minY);
    }
    extent = Math.max(extent, Math.abs(step.extrude?.towardsNormal || 0) + Math.abs(step.extrude?.oppositeNormal || 0));
  }
  const scale = extent > 0 ? targetSize / extent : 1;
  const lines = [];
  steps.slice(0, 8).forEach((step, i) => {
    const plane = planeName(step.plane);
    const profiles = [];
    for (const face of step.faces || []) {
      const loops = face.loops || [];
      if (!loops.length) continue;
      const outer = describeLoop(loops[0], scale);
      const holes = loops.slice(1).map(loop => describeLoop(loop, scale));
      profiles.push(holes.length ? `${outer} with ${holes.length} hole${holes.length > 1 ? "s" : ""} (${holes.slice(0, 4).join("; ")}${holes.length > 4 ? "; ..." : ""})` : outer);
    }
    const depth = (Math.abs(step.extrude?.towardsNormal || 0) + Math.abs(step.extrude?.oppositeNormal || 0)) * scale;
    const both = (step.extrude?.towardsNormal || 0) > 0 && (step.extrude?.oppositeNormal || 0) > 0 ? " (both directions)" : "";
    const op = { new: "new body", join: "ADD to the body", cut: "CUT from the body", intersect: "INTERSECT with the body" }[step.extrude?.operation] || step.extrude?.operation;
    const offset = Math.abs(plane.offset) > 1e-6 ? ` offset ${fmt(plane.offset * scale)} in` : "";
    lines.push(`  ${i + 1}. sketch on the ${plane.name}${offset}: ${profiles.slice(0, 3).join(" + ")}${profiles.length > 3 ? ` + ${profiles.length - 3} more profiles` : ""}; extrude ${fmt(depth)} in${both}, ${op}`);
  });
  if (steps.length > 8) lines.push(`  ... ${steps.length - 8} more steps`);
  return lines.join("\n");
}

/**
 * Up to `k` reference recipes for the prompt: { name, recipe } from the closest dataset
 * parts. Prefers parts whose main noun matches, then parts sharing the most words; skips
 * single-step plain parts when richer ones exist (they teach nothing about detail).
 */
export function datasetReferences(prompt, { k = 2, maxChars = 1800 } = {}) {
  let found = [];
  try {
    const strict = searchLibrary(prompt, 8);
    const loose = searchLibrary(prompt, 20, { requireHead: false });
    const seen = new Set();
    for (const candidate of [...strict, ...loose]) {
      if (seen.has(candidate.part.uid)) continue;
      seen.add(candidate.part.uid);
      found.push(candidate);
    }
  } catch {
    return [];
  }
  const head = headNoun(prompt);
  const rich = found.filter(c => (c.part.ops || []).length >= 2 || (c.part.steps || 0) >= 2);
  const pool = (rich.length >= k ? rich : found).slice(0, 12);
  pool.sort((a, b) => (Number(b.part.head === head) - Number(a.part.head === head)) || (b.coverage - a.coverage) || (b.score - a.score));
  const out = [];
  let used = 0;
  for (const candidate of pool) {
    if (out.length >= k) break;
    let recipe = "";
    try {
      recipe = describeSequence(readSequence(candidate.part));
    } catch {
      continue;
    }
    if (!recipe) continue;
    const name = String(candidate.part.name).slice(0, 160);
    if (used + recipe.length + name.length > maxChars) break;
    used += recipe.length + name.length;
    out.push({ name, recipe });
  }
  return out;
}

// ── BenchCAD: named mechanical parts as CadQuery programs (data/benchcad_refs.json.gz,
// built by scripts/dataset_refs/build_benchcad.py; CC-BY 4.0). Unlike DeepCAD these use
// revolves, fillets, chamfers, holes, sweeps and lofts.
let benchcad = null;
function loadBenchcad() {
  if (benchcad) return benchcad;
  try {
    const file = fileURLToPath(new URL("./data/benchcad_refs.json.gz", import.meta.url));
    benchcad = existsSync(file) ? JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")).refs || [] : [];
  } catch {
    benchcad = [];
  }
  return benchcad;
}

const words = text => String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1).map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

/** Best BenchCAD programs for the prompt: the family's main word must appear in the prompt. */
export function benchcadReferences(prompt, k = 1) {
  const asked = new Set(words(prompt));
  // The thing asked for decides: "a flange with bolt holes" is a flange, not a bolt.
  const head = tokenize(String(headNoun(prompt) || "")).pop();
  const scored = [];
  for (const ref of loadBenchcad()) {
    const family = words(ref.family);
    if (!family.length || !head || tokenize(family[family.length - 1]).pop() !== head) continue;
    const shared = family.filter(w => asked.has(w)).length + words(ref.variant).filter(w => asked.has(w)).length * 0.5;
    scored.push({ ref, score: shared / family.length + (ref.difficulty === "easy" ? 0 : 0.1) });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = [];
  const families = new Set();
  for (const { ref } of scored) {
    if (families.has(ref.family)) continue;
    families.add(ref.family);
    out.push(ref);
    if (out.length >= k) break;
  }
  return out;
}

/** The prompt block for the AI (empty string when nothing relevant was found). */
export function datasetReferenceBlock(prompt, options) {
  const refs = datasetReferences(prompt, options);
  const programs = benchcadReferences(prompt, 1);
  if (!refs.length && !programs.length) return "";
  return [
    "DATASET_REFS: real parts from CAD datasets closest to this request.",
    "Use them for realistic structure, proportions and level of detail (which features, what is added or cut);",
    "adapt them to the request, do not copy them, and still build everything the user asked for.",
    ...programs.map(ref => [
      `REAL ${ref.family.replace(/_/g, " ").toUpperCase()} (BenchCAD${ref.standard ? `, ${ref.standard}` : ""}) in CadQuery; build the same features in FeatureScript `
      + "(.circle/.rect/.polygon -> sketch + opExtrude or kitBox/kitCylinder, .revolve -> opRevolve, .hole/.cutBlind -> a cutter + opBoolean SUBTRACTION/kitCut, "
      + ".fillet -> opFillet, .chamfer -> opChamfer, .shell -> opShell, .union/.cut -> opBoolean; CadQuery sizes are mm):",
      ref.code,
    ].join("\n")),
    ...refs.map((ref, i) => `REFERENCE ${i + 1}: "${ref.name}" (DeepCAD)\n${ref.recipe}`),
  ].join("\n");
}
