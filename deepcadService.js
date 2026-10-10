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

const MODEL_URL = String(process.env.DEEPCAD_MODEL_URL || "").trim().replace(/\/+$/, "");
const MODEL_TOKEN = String(process.env.DEEPCAD_MODEL_TOKEN || "").trim();
const MODEL_TIMEOUT_MS = Number(process.env.DEEPCAD_MODEL_TIMEOUT_MS || 120000);
// A sleeping Hugging Face Space answers 503 while it boots and loads the model.
const MODEL_WAKE_BUDGET_MS = Number(process.env.DEEPCAD_MODEL_WAKE_MS || 240000);

export function getDeepcadConfig() {
  return { configured: Boolean(MODEL_URL), url: MODEL_URL || null, onshapeCompileCheck: isOnshapeConfigured() };
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchModelSequence(prompt) {
  if (!MODEL_URL) {
    throw new DeepcadError(
      "DEEPCAD_MODEL_URL is not set. Deploy hf_space/ as a Hugging Face Space and set DEEPCAD_MODEL_URL to its URL (https://<user>-<space>.hf.space).",
      503,
    );
  }
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
      if (attempt < 3 && Date.now() - started < MODEL_WAKE_BUDGET_MS) {
        await sleep(Math.min(5000 * attempt, 20000));
        continue;
      }
      throw new DeepcadError(`Model service at ${MODEL_URL} did not respond: ${err.message}`, 503);
    }

    if (response.status === 503 && Date.now() - started < MODEL_WAKE_BUDGET_MS) {
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
    return { sequence: data.sequence, elapsedSec: data.elapsedSec ?? null, model: data.model || "Text2CAD", attempts: attempt };
  }
}

/**
 * Static validator + (optional) live Onshape execution.
 * verdict: "works_in_onshape" | "fails_in_onshape" | "static_ok" (Onshape not checked) | "static_errors"
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
  const onshape = await testCompileFeatureScript(code);
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
  else verdict = staticResult.ok ? "static_ok" : "static_errors";
  return { verdict, static: staticResult, onshape: onshapeResult };
}

/**
 * Generate a feature from a prompt via the model, or compile a supplied sequence
 * (cad-sequence/v1, DeepCAD JSON, or Text2CAD minimal JSON).
 */
export async function generateDeepcadFeature({ prompt = "", sequence = null, sizeInches = null, featureLabel = null } = {}) {
  const started = Date.now();
  let source = "uploaded_sequence";
  let model = null;
  let input = sequence;
  if (!input) {
    if (!String(prompt).trim()) throw new DeepcadError("Provide a prompt or a CAD sequence.", 400);
    const fetched = await fetchModelSequence(String(prompt).trim());
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

  const verification = await verifyFeatureScript(compiled.code);
  const warnings = [...compiled.warnings];
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
    warnings,
    elapsedSec: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}
