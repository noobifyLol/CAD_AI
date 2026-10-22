/**
 * deepcadService.js — the DeepCAD/Text2CAD generation path and FeatureScript verification.
 *
 *   prompt ──► Text2CAD model (Hugging Face Space, hf_space/) ──► cad-sequence/v1
 *          ──► deepcadCompiler.js ──► FeatureScript ──► verifyFeatureScript()
 *
 * verifyFeatureScript runs the project's strict static validator and, when Onshape
 * API keys are configured, executes the feature in a real Onshape Part Studio
 * (onshapeClient.js) so the website can show whether the code actually works.
 */
import { compileCadSequenceToFeatureScript } from "./deepcadCompiler.js";
import { isOnshapeConfigured, testCompileFeatureScript } from "./onshapeClient.js";
import { validateFeatureScriptStrict } from "./ai.js";
import { libraryInfo, matchLibraryPart } from "./deepcadLibrary.js";
import { localBuildFeatureScript } from "./localBuild.js";

const MODEL_URL = String(process.env.DEEPCAD_MODEL_URL || "").trim().replace(/\/+$/, "");
const MODEL_TOKEN = String(process.env.DEEPCAD_MODEL_TOKEN || "").trim();
const MODEL_TIMEOUT_MS = Number(process.env.DEEPCAD_MODEL_TIMEOUT_MS || 120000);
// A sleeping Hugging Face Space answers 503 while it boots and loads the model.
const MODEL_WAKE_BUDGET_MS = Number(process.env.DEEPCAD_MODEL_WAKE_MS || 240000);

export function getDeepcadConfig() {
  return { configured: Boolean(MODEL_URL), url: MODEL_URL || null, onshapeCompileCheck: isOnshapeConfigured(), library: libraryInfo() };
}

export class DeepcadError extends Error {
  constructor(message, status = 502, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const UNIT_INCHES = { mm: 1 / 25.4, millimeter: 1 / 25.4, millimeters: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254, in: 1, inch: 1, inches: 1, '"': 1, ft: 12, feet: 12, foot: 12 };

/** Largest explicit dimension in the prompt, in inches ("a 40 mm plate" → 1.575), or null. */
export function parseOverallSizeInches(prompt) {
  const pattern = /(\d+(?:\.\d+)?)\s*(millimeters?|mm|cm|m|inches|inch|in|"|ft|feet|foot)(?![a-z])/gi;
  let best = null;
  for (const match of String(prompt || "").matchAll(pattern)) {
    const inches = Number(match[1]) * UNIT_INCHES[match[2].toLowerCase()];
    if (Number.isFinite(inches) && inches > 0) best = Math.max(best ?? 0, inches);
  }
  return best;
}

/** "A 60 mm plate with a raised slot boss..." → "A 60 mm plate with a raised slot boss" (≤ 40 chars, whole words). */
function labelFromPrompt(prompt) {
  const words = String(prompt || "").trim().replace(/[^\w\s.-]/g, "").split(/\s+/).filter(Boolean);
  let label = "";
  for (const word of words) {
    if (`${label} ${word}`.trim().length > 40) break;
    label = `${label} ${word}`.trim();
  }
  return label || "DeepCAD Part";
}

// Text2CAD only builds flat sketches pushed straight out (extrudes), and it learned from
// geometric descriptions ("a rectangular plate with four holes"), not object names.
// Shapes that need a revolve, loft, sweep, taper, thread, fillet or a curved surface go
// to the parametric generator instead: Text2CAD would return the nearest extruded shape
// (a traffic cone came back as a washer).
const NEEDS_PARAMETRIC = [
  "cone", "conical", "taper", "sphere", "spherical", "ball", "dome", "hemisphere", "gear", "sprocket",
  "spring", "coil", "helix", "helical", "spiral", "thread", "screw", "bolt", "bottle", "vase", "cup",
  "mug", "bowl", "funnel", "torus", "donut", "doughnut", "revolve", "loft", "sweep", "fillet", "chamfer",
  "rounded", "curved", "elbow", "bend", "propeller", "blade", "airfoil", "wing", "pyramid", "wedge",
  "ramp", "knob", "handle", "wheel", "spoke", "pulley", "nozzle", "bell", "lamp", "teapot", "chair",
  "table", "car", "phone", "pen", "pencil", "hook", "clip", "hinge", "vehicle", "toy", "figure",
];
const DEEPCAD_FRIENDLY = [
  "plate", "block", "cube", "box", "cuboid", "cylinder", "cylindrical", "ring", "washer", "disc",
  "disk", "hole", "slot", "bracket", "flange", "spacer", "bar", "rod", "tube", "pipe", "hexagon",
  "hexagonal", "hex", "rectangle", "rectangular", "square", "circle", "circular", "prism", "panel",
  "frame", "boss", "pocket", "step", "stepped", "tab", "cutout", "extrude", "extruded", "l-shaped",
  "t-shaped", "u-shaped", "channel", "beam", "shaft", "collar", "bushing", "nut", "sheet", "base",
  "mount", "standoff", "puck", "cap",
];
const wordIn = (list, text) => list.find(word => new RegExp(`\\b${word.replace("-", "[- ]?")}s?\\b`, "i").test(text));

/** Should this prompt go to the Text2CAD model? { fits, reason } */
export function assessDeepcadFit(prompt) {
  // "bolt holes" / "screw holes" are just holes, not threaded parts.
  const text = String(prompt || "").replace(/\b(bolt|screw)[- ]?(holes?|circle|pattern)\b/gi, "$2");
  const blocker = wordIn(NEEDS_PARAMETRIC, text);
  if (blocker) {
    return { fits: false, reason: `"${blocker}" needs shapes the DeepCAD model cannot make (it only extrudes flat sketches)` };
  }
  // Shapes Text2CAD consistently gets wrong (24-prompt survey, 2026-10-10; decoding is
  // deterministic, so the same prompt always fails the same way). Skipping the model for
  // these saves Modal credits that would only be spent on a result Auto discards.
  const lower = String(prompt || "").toLowerCase(); // original text: "bolt holes" still intact
  const knownMiss = [
    [/\b[ltu][- ]?shaped\b|\bangle bracket\b|\bchannel\b/, "L/T/U profiles come back as plain rectangles"],
    [/\b(boss|on top|stacked|stepped|step|raised|with a (smaller|larger))\b/, "stacked features come back as a single body"],
    [/\b(slots?|cut-?outs?|pockets?|recess(es)?|notch(es)?|window)\b/, "slots, cutouts and pockets get left out"],
    [/\b(tube|pipe)s?\b/, "tubes come back as solid cylinders"],
    [/\b(2|3|5|6|7|8|9|10|12|two|three|five|six|seven|eight|nine|ten|twelve)\s+(?:(?!(?:mm|cm|m|in|inch|inches)\b)[a-z-]+\s+){0,2}holes?\b/, "hole counts other than one or four come out wrong"],
    [/\bbolt[- ]?holes?\b/, "bolt-hole patterns come out wrong"],
  ].find(([pattern]) => pattern.test(lower));
  if (knownMiss) return { fits: false, reason: `the DeepCAD model gets this kind of part wrong (${knownMiss[1]})` };

  const geometric = wordIn(DEEPCAD_FRIENDLY, text);
  if (!geometric) {
    return { fits: false, reason: "the prompt does not describe a flat, extruded part (plate, ring, bracket, block...)" };
  }
  return { fits: true, reason: `"${geometric}" is a sketch-and-extrude shape` };
}

// The part library holds real extruded parts, so it can give curved SKETCHES (rounded
// plates, hooks, brackets with arcs) but not true 3D-revolved/lofted/swept shapes; their
// "cone"/"bottle" descriptions are flat silhouettes. Those go to the parametric generator.
const LIBRARY_3D_ONLY = /\b(cones?|conical|taper(ed)?|spheres?|spherical|balls?|domes?|hemispheres?|bottles?|vases?|cups?|mugs?|bowls?|funnels?|torus|donuts?|doughnuts?|springs?|coils?|helix|helical|threads?|threaded|revolved?|lofted?|swept|sweep|propellers?|airfoils?|wings?)\b/i;

/**
 * Closest real DeepCAD part for the prompt, compiled to FeatureScript (free, no model).
 * Returns the same shape as generateDeepcadFeature, or null when nothing fits well enough.
 */
export async function generateFromLibrary(prompt, { sizeInches = null, featureLabel = null } = {}) {
  const text = String(prompt || "").trim();
  if (!text || LIBRARY_3D_ONLY.test(text)) return null;
  const started = Date.now();
  const match = matchLibraryPart(text, sequence => {
    const compiled = compileCadSequenceToFeatureScript(sequence);
    return compiled.ok && !findMissingFeatures(text, compiled.sequence).length;
  });
  if (!match) return null;
  const size = Number(sizeInches) > 0 ? Number(sizeInches) : parseOverallSizeInches(text);
  const label = featureLabel || labelFromPrompt(text);
  const compiled = compileCadSequenceToFeatureScript(match.sequence, { sizeInches: size, featureLabel: label, featureName: "deepcadPart" });
  if (!compiled.ok) return null;
  const verification = await verifyFeatureScript(compiled.code);
  if (verification.verdict === "static_errors" || verification.verdict === "fails_in_onshape") return null;
  const warnings = [...compiled.warnings, `Closest real DeepCAD part: "${match.part.name.slice(0, 160)}".`];
  if (!size) warnings.push(`No size in the prompt; the part defaults to ${compiled.stats.defaultSizeInches} in across. Change "Overall Size" in the feature dialog.`);
  return {
    code: compiled.code,
    featureName: compiled.featureName,
    featureLabel: compiled.featureLabel,
    generationMode: "deepcad_library",
    sequence: compiled.sequence,
    stats: compiled.stats,
    model: { name: "DeepCAD part library", match: match.part.name, uid: match.part.uid, coverage: Number(match.coverage.toFixed(2)) },
    verification,
    missingFeatures: [],
    warnings,
    elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

/**
 * Cheap sanity check of a model result against the prompt: Text2CAD sometimes drops
 * requested features (the hole in a plate, the boss on a block, the L of a bracket).
 * Returns a list of what is missing; empty means the result plausibly matches.
 */
export function findMissingFeatures(prompt, sequence) {
  const text = String(prompt || "").toLowerCase();
  const steps = sequence?.steps || [];
  const loops = steps.flatMap(step => step.faces.flatMap(face => face.loops.map((loop, index) => ({ loop, inner: index > 0, op: step.extrude.operation }))));
  const holeLike = loops.filter(entry => entry.inner).length + steps.filter(step => step.extrude.operation === "cut").length;
  const missing = [];

  // "four holes" counts; "20 mm hole" is a size, not a count (units cannot sit between).
  const holes = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:(?!(?:mm|cm|m|in|inch|inches|ft|millimeters?)\b)[a-z-]+\s+){0,2}holes?\b/);
  const impliesHole = /\b(holes?|bore|opening|inner diameter|hollow|nut|washer|tube|pipe|collar|bushing|spacer)\b/.test(text);
  const wantedHoles = holes ? Number(holes[1]) || NUMBER_WORDS[holes[1]] : impliesHole ? 1 : 0;
  // An explicit count must match exactly ("two holes" with four is wrong too).
  if (holes && holeLike !== wantedHoles) missing.push(`asked for ${wantedHoles} hole${wantedHoles > 1 ? "s" : ""}, model made ${holeLike}`);
  else if (!holes && wantedHoles && holeLike < wantedHoles) missing.push(`asked for a hole, model made none`);
  if (/\b(slots?|cut-?outs?|pockets?|recess(es)?|notch(es)?|window)\b/.test(text) && !holes && !impliesHole && holeLike === 0) {
    missing.push("asked for a slot/cutout/pocket, model cut nothing");
  }

  if (/\b(boss|on top|stacked|step(ped)?|raised|with a (smaller|larger))\b/.test(text) && steps.filter(step => step.extrude.operation !== "cut").length < 2) {
    missing.push("asked for a second feature on the part, model made a single body");
  }
  if (/\b([lut])[- ]?shaped\b|\bangle bracket\b/.test(text)) {
    const mostSides = Math.max(0, ...loops.filter(entry => !entry.inner).map(entry => entry.loop.length));
    if (mostSides < 6 && steps.length < 2) missing.push("asked for an L/T/U profile, model made a plain rectangle");
  }
  if (/\bhex(agon(al)?)?\b/.test(text) && !loops.some(entry => entry.loop.length === 6)) {
    missing.push("asked for a hexagon, model made no six-sided profile");
  }
  return missing;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Auto mode gives up sooner: a normal wake-up takes well under a minute, and when the
// service is out of credits or down the page should fall back to Parametric AI quickly.
const AUTO_WAKE_BUDGET_MS = Number(process.env.DEEPCAD_AUTO_WAKE_MS || 90000);
const SEQUENCE_CACHE_LIMIT = 300;
const sequenceCache = new Map(); // normalized prompt -> model result (oldest evicted first)

async function fetchModelSequence(prompt, wakeBudgetMs = MODEL_WAKE_BUDGET_MS) {
  if (!MODEL_URL) {
    throw new DeepcadError(
      "DEEPCAD_MODEL_URL is not set. Deploy hf_space/ as a Hugging Face Space and set DEEPCAD_MODEL_URL to its URL (https://<user>-<space>.hf.space).",
      503,
    );
  }
  // Decoding is deterministic (greedy), so a repeated prompt gives the same sequence:
  // answer it from memory instead of spending Modal credits again.
  const cacheKey = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (sequenceCache.has(cacheKey)) return { ...sequenceCache.get(cacheKey), attempts: 0, cached: true };

  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
      response = await fetch(`${MODEL_URL}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(MODEL_TOKEN ? { Authorization: `Bearer ${MODEL_TOKEN}` } : {}),
        },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    } catch (err) {
      // Network failures (bad URL, DNS, refused) retry a couple of times only;
      // a sleeping Space answers 503 instead, which is handled below.
      if (attempt < 3 && Date.now() - started < wakeBudgetMs) {
        await sleep(Math.min(5000 * attempt, 20000));
        continue;
      }
      throw new DeepcadError(`Model service at ${MODEL_URL} did not respond: ${err.message}`, 503);
    }

    if (response.status === 503 && Date.now() - started < wakeBudgetMs) {
      await sleep(Math.min(5000 * attempt, 20000)); // Space waking up / model loading
      continue;
    }
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON error page from the hosting proxy
    }
    if (!response.ok) {
      const detail = data?.detail || text.slice(0, 300);
      // 422 = the model answered but its output was not a usable CAD sequence.
      throw new DeepcadError(`Model service returned ${response.status}: ${detail}`, response.status === 422 ? 422 : 502);
    }
    if (!data?.sequence) throw new DeepcadError("Model service response had no sequence.", 502);
    const result = { sequence: data.sequence, elapsedSec: data.elapsedSec ?? null, model: data.model || "Text2CAD" };
    if (sequenceCache.size >= SEQUENCE_CACHE_LIMIT) sequenceCache.delete(sequenceCache.keys().next().value);
    sequenceCache.set(cacheKey, result);
    return { ...result, attempts: attempt };
  }
}

/**
 * Static validator + (optional) live Onshape execution.
 * verdict: "works_in_onshape" | "fails_in_onshape" | "fails_test_build" | "builds_locally" (local test build
 * passed, Onshape not checked) | "static_ok" (nothing built) | "static_errors"
 */
export async function verifyFeatureScript(code) {
  const strict = validateFeatureScriptStrict(code);
  const staticResult = {
    ok: strict.ok,
    issues: [...strict.fatalIssues, ...strict.blockingIssues].slice(0, 12).map(issue => ({
      message: issue.message,
      line: issue.line ?? issue.lineNo ?? null,
    })),
  };
  // Free local test build first; the Onshape API (limited calls per year) only for local passes.
  const local = await localBuildFeatureScript(code);
  const localResult = {
    attempted: local.attempted,
    ok: local.ok,
    error: local.error || null,
    line: local.line || null,
    metrics: local.metrics || null,
  };
  const onshape = local.ok === false
    ? { attempted: false, ok: null, errors: [], skippedReason: "Skipped: the local test build already failed." }
    : await testCompileFeatureScript(code);
  const onshapeResult = {
    attempted: onshape.attempted,
    ok: onshape.ok,
    errors: onshape.errors || [],
    warnings: (onshape.warnings || []).slice(0, 8),
    skippedReason: onshape.skippedReason || null,
  };
  let verdict;
  if (onshapeResult.ok === true) verdict = "works_in_onshape";
  else if (onshapeResult.ok === false) verdict = "fails_in_onshape";
  else if (localResult.ok === false) verdict = "fails_test_build";
  else if (localResult.ok === true) verdict = "builds_locally";
  else verdict = staticResult.ok ? "static_ok" : "static_errors";
  return { verdict, static: staticResult, local: localResult, onshape: onshapeResult };
}

/**
 * Generate a feature from a prompt via the model, or compile a supplied sequence
 * (cad-sequence/v1, DeepCAD JSON, or Text2CAD minimal JSON).
 */
export async function generateDeepcadFeature({ prompt = "", sequence = null, sizeInches = null, featureLabel = null, autoFallback = false } = {}) {
  const started = Date.now();
  let source = "uploaded_sequence";
  let model = null;
  let input = sequence;
  if (!input) {
    if (!String(prompt).trim()) throw new DeepcadError("Provide a prompt or a CAD sequence.", 400);
    const fetched = await fetchModelSequence(String(prompt).trim(), autoFallback ? AUTO_WAKE_BUDGET_MS : MODEL_WAKE_BUDGET_MS);
    input = fetched.sequence;
    model = { name: fetched.model, elapsedSec: fetched.elapsedSec, attempts: fetched.attempts };
    source = "text2cad_model";
  }

  const size = Number(sizeInches) > 0 ? Number(sizeInches) : parseOverallSizeInches(prompt);
  const label = featureLabel || labelFromPrompt(prompt);
  const compiled = compileCadSequenceToFeatureScript(input, {
    sizeInches: size,
    featureLabel: label,
    featureName: "deepcadPart",
  });
  if (!compiled.ok) {
    throw new DeepcadError(`The CAD sequence could not be compiled: ${compiled.errors.slice(0, 5).join("; ")}`, 422, compiled.errors);
  }

  const missingFeatures = source === "text2cad_model" ? findMissingFeatures(prompt, compiled.sequence) : [];
  if (missingFeatures.length && autoFallback) {
    // Auto mode: skip the (slow, rate-limited) Onshape check for a result we will discard.
    return { missingFeatures, sequence: compiled.sequence };
  }
  const verification = await verifyFeatureScript(compiled.code);
  const warnings = [...compiled.warnings];
  if (missingFeatures.length) warnings.push(`The model may have left something out: ${missingFeatures.join("; ")}.`);
  if (input?.dropped?.length) warnings.push(`Model steps skipped: ${input.dropped.join("; ")}.`);
  if (!size && (compiled.sequence.units || "normalized") === "normalized") {
    warnings.push(`No size in the prompt; the part defaults to ${compiled.stats.defaultSizeInches} in across. Change "Overall Size" in the feature dialog.`);
  }

  return {
    code: compiled.code,
    featureName: compiled.featureName,
    featureLabel: compiled.featureLabel,
    generationMode: source === "text2cad_model" ? "deepcad_text2cad_model" : "deepcad_sequence_import",
    sequence: compiled.sequence,
    stats: compiled.stats,
    model,
    verification,
    missingFeatures,
    warnings,
    elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}
