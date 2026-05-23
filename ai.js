import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import Groq from "groq-sdk";

const TEXT_MODEL = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const FAST_MODEL = process.env.GROQ_FAST_MODEL || TEXT_MODEL;
const COMPLEX_MODEL = process.env.GROQ_COMPLEX_MODEL || TEXT_MODEL;
const DIM_MODEL = process.env.GROQ_DIM_MODEL || COMPLEX_MODEL;
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || TEXT_MODEL;
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const GENERATION_STRATEGY = String(process.env.CAD_GENERATION_MODE || "ai_first").toLowerCase();
// The live generation path should prefer Groq reasoning plus FeatureScript docs.
// Template injection and template fallback stay opt-in for emergency recovery only.
const USE_VALIDATED_TEMPLATES = String(process.env.USE_VALIDATED_TEMPLATES || "false").toLowerCase() === "true";
const ALLOW_TEMPLATE_FALLBACK = String(process.env.ALLOW_TEMPLATE_FALLBACK || "false").toLowerCase() === "true";

// ------------------------------
// Model configuration
// ------------------------------
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 120000);
const GROQ_MAX_COMPLETION_TOKENS = Number(process.env.GROQ_MAX_COMPLETION_TOKENS || 8192);
const GROQ_MAX_PROMPT_CHARS = Number(process.env.GROQ_MAX_PROMPT_CHARS || 160000);
const GROQ_TEMPERATURE = Number(process.env.GROQ_TEMPERATURE || 0.2);
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 12000);
const VISION_MAX_TOKENS = Number(process.env.GROQ_VISION_MAX_TOKENS || 800);
const CAD_CANDIDATE_COUNT = Math.max(1, Math.min(6, Number(process.env.CAD_CANDIDATE_COUNT || 3)));
const CAD_REPAIR_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.CAD_REPAIR_ATTEMPTS || 3)));
const CAD_RETRIEVAL_WORKERS = Math.max(1, Math.min(6, Number(process.env.CAD_RETRIEVAL_WORKERS || 3)));
const MULTI_KEY_ENABLED = String(process.env.GROQ_MULTI_KEY_ENABLED || "true").toLowerCase() !== "false";
const MAX_RETRIEVED_SNIPPETS = Math.max(1, Math.min(6, Number(process.env.CAD_MAX_RETRIEVED_SNIPPETS || 6)));
const MAX_RETRIEVED_SNIPPET_CHARS = Math.max(400, Math.min(4000, Number(process.env.CAD_MAX_RETRIEVED_SNIPPET_CHARS || 2200)));
const MAX_OMNI_SUMMARY_CHARS = Math.max(400, Math.min(2400, Number(process.env.CAD_MAX_OMNI_SUMMARY_CHARS || 1100)));
const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FS_EXAMPLES_DIR = join(PROJECT_ROOT, "data", "fs_examples");
const SOURCE_KNOWLEDGE_PATH = join(PROJECT_ROOT, "data", "sourceKnowledge.new.json");
const DATASET_SUMMARY_PATH = join(PROJECT_ROOT, "data", "cadDatasetSummaries.json");
const LOCAL_OMNI_SUMMARY_PATHS = [
  join(PROJECT_ROOT, "docs", "research_summaries", "cad_mllm_and_omni_cad.md"),
  join(PROJECT_ROOT, "docs", "research_summaries", "local_omni_cad_dataset.md"),
  join(PROJECT_ROOT, "docs", "research_summaries", "deepcad.md"),
  join(PROJECT_ROOT, "docs", "research_summaries", "cambridge_text_to_design.md"),
];
const NUMBERED_SHARED_GROQ_KEYS = [
  "GROQ_API_KEY",
  "GROQ_API_KEY2",
  "GROQ_API_KEY3",
  "GROQ_API_KEY4",
  "GROQ_API_KEY5",
  "GROQ_API_KEY6",
  "GROQ_API_KEY7",
  "GROQ_API_KEY8",
  "GROQ_API_KEY9",
];
const FIXED_KEY_SLOT_SEQUENCE = ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"];
const STAGE_API_KEY_ENV = {
  shared: ["GROQ_API_KEYS", ...NUMBERED_SHARED_GROQ_KEYS],
  dimensions: ["GROQ_DIM_API_KEYS", "GROQ_DIM_API_KEY"],
  planning: ["GROQ_PLAN_API_KEYS", "GROQ_PLAN_API_KEY"],
  retrieval: ["GROQ_RETRIEVAL_API_KEYS", "GROQ_RETRIEVAL_API_KEY"],
  generation: ["GROQ_GENERATION_API_KEYS", "GROQ_GENERATION_API_KEY"],
  repair: ["GROQ_REPAIR_API_KEYS", "GROQ_REPAIR_API_KEY"],
  validation: ["GROQ_VALIDATION_API_KEYS", "GROQ_VALIDATION_API_KEY"],
  vision: ["GROQ_VISION_API_KEYS", "GROQ_VISION_API_KEY"],
};
const groqClientCache = new Map();
const stageCursor = new Map();
let cachedFsExampleLibrary = null;
let cachedOmniSummaryText = null;
let cachedSourceKnowledgeRows = null;
let cachedDatasetSummaryRows = null;

function splitEnvList(rawValue) {
  return String(rawValue || "")
    .split(/[\r\n,;]+/)
    .map(value => value.trim())
    .filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function loadStageKeys(stage) {
  const sharedKeys = uniqueStrings(
    (STAGE_API_KEY_ENV.shared || []).flatMap(name => splitEnvList(process.env[name]))
  );
  const stageKeys = uniqueStrings(
    (STAGE_API_KEY_ENV[stage] || []).flatMap(name => splitEnvList(process.env[name]))
  );
  return uniqueStrings(stageKeys.length ? stageKeys : sharedKeys);
}

function getStageKeyPool(stage = "generation") {
  const requestedStage = Object.prototype.hasOwnProperty.call(STAGE_API_KEY_ENV, stage) ? stage : "generation";
  const pool = loadStageKeys(requestedStage);
  if (!pool.length) {
    throw new Error("Missing Groq API key configuration. Set GROQ_API_KEY or GROQ_API_KEYS.");
  }
  return MULTI_KEY_ENABLED ? pool : [pool[0]];
}

function stableHash(input) {
  let hash = 0;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickStageCredential(stage = "generation", affinity = "") {
  const pool = getStageKeyPool(stage);
  let slotIndex = 0;
  const requestedSlot = arguments.length > 2 ? arguments[2] : null;

  if (requestedSlot && /^k\d+$/i.test(String(requestedSlot))) {
    const explicitIndex = Math.max(0, Number(String(requestedSlot).slice(1)) - 1);
    slotIndex = explicitIndex % pool.length;
  } else if (affinity) {
    slotIndex = stableHash(`${stage}:${affinity}`) % pool.length;
  } else {
    const current = stageCursor.get(stage) || 0;
    slotIndex = current % pool.length;
    stageCursor.set(stage, current + 1);
  }

  return {
    apiKey: pool[slotIndex],
    slotIndex,
    slotLabel: requestedSlot && /^k\d+$/i.test(String(requestedSlot))
      ? String(requestedSlot).toLowerCase()
      : `${stage}-slot-${slotIndex + 1}`,
    poolSize: pool.length,
  };
}

function getGroqClient(apiKey, timeout) {
  const cacheKey = `${timeout}:${apiKey}`;
  if (!groqClientCache.has(cacheKey)) {
    groqClientCache.set(cacheKey, new Groq({
      apiKey,
      timeout,
      maxRetries: 0,
    }));
  }
  return groqClientCache.get(cacheKey);
}

function loadFsExampleLibrary() {
  if (cachedFsExampleLibrary) return cachedFsExampleLibrary;
  if (!existsSync(FS_EXAMPLES_DIR)) {
    cachedFsExampleLibrary = [];
    return cachedFsExampleLibrary;
  }

  cachedFsExampleLibrary = readdirSync(FS_EXAMPLES_DIR)
    .filter(fileName => fileName.endsWith(".fs"))
    .map(fileName => {
      const fullPath = join(FS_EXAMPLES_DIR, fileName);
      return {
        id: basename(fileName, ".fs"),
        fileName,
        content: readFileSync(fullPath, "utf8"),
      };
    });

  return cachedFsExampleLibrary;
}

function loadLocalOmniSummaryText() {
  if (cachedOmniSummaryText !== null) return cachedOmniSummaryText;
  cachedOmniSummaryText = LOCAL_OMNI_SUMMARY_PATHS
    .filter(filePath => existsSync(filePath))
    .map(filePath => readFileSync(filePath, "utf8"))
    .join("\n");
  return cachedOmniSummaryText;
}

function loadJsonRows(filePath, cacheKey) {
  if (cacheKey === "source" && cachedSourceKnowledgeRows) return cachedSourceKnowledgeRows;
  if (cacheKey === "dataset" && cachedDatasetSummaryRows) return cachedDatasetSummaryRows;
  if (!existsSync(filePath)) {
    if (cacheKey === "source") cachedSourceKnowledgeRows = [];
    if (cacheKey === "dataset") cachedDatasetSummaryRows = [];
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.rows)
        ? parsed.rows
        : [];
    if (cacheKey === "source") cachedSourceKnowledgeRows = rows;
    if (cacheKey === "dataset") cachedDatasetSummaryRows = rows;
    return rows;
  } catch (err) {
    console.warn(`[AI] Could not read ${cacheKey} rows from ${filePath}: ${err.message}`);
    if (cacheKey === "source") cachedSourceKnowledgeRows = [];
    if (cacheKey === "dataset") cachedDatasetSummaryRows = [];
    return [];
  }
}

function loadSourceKnowledgeRows() {
  return loadJsonRows(SOURCE_KNOWLEDGE_PATH, "source");
}

function loadDatasetSummaryRows() {
  return loadJsonRows(DATASET_SUMMARY_PATH, "dataset");
}

export function getModelConfig() {
  const sharedKeyCount = loadStageKeys("shared").length;
  return {
    provider: "groq",
    text: TEXT_MODEL,
    fast: FAST_MODEL,
    complex: COMPLEX_MODEL,
    dimensions: DIM_MODEL,
    fallback: FALLBACK_MODEL,
    validatedTemplates: USE_VALIDATED_TEMPLATES,
    allowTemplateFallback: ALLOW_TEMPLATE_FALLBACK,
    vision: VISION_MODEL,
    multiKeyEnabled: MULTI_KEY_ENABLED,
    candidateCount: CAD_CANDIDATE_COUNT,
    retrievalWorkers: CAD_RETRIEVAL_WORKERS,
    sharedKeyCount,
    stageKeyCounts: {
      dimensions: safeStageKeyCount("dimensions"),
      planning: safeStageKeyCount("planning"),
      retrieval: safeStageKeyCount("retrieval"),
      generation: safeStageKeyCount("generation"),
      repair: safeStageKeyCount("repair"),
      validation: safeStageKeyCount("validation"),
      vision: safeStageKeyCount("vision"),
    },
  };
}

function truncateForLog(text, max = 800) {
  const normalized = typeof text === "string" ? text : JSON.stringify(text);
  return normalized.length > max ? `${normalized.slice(0, max)}...<truncated>` : normalized;
}

async function parseJsonResponse(response, label) {
  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (err) {
    const error = new Error(`${label} returned invalid JSON (status ${response.status})`);
    error.cause = err;
    error.details = {
      status: response.status,
      statusText: response.statusText,
      body: truncateForLog(rawText),
    };
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`${label} request failed with status ${response.status}`);
    error.details = {
      status: response.status,
      statusText: response.statusText,
      body: truncateForLog(rawText),
      data,
    };
    throw error;
  }

  return data;
}

function logFetchError(label, err, extra = {}) {
  console.error(`[${label}] request failed`, {
    message: err?.message || String(err),
    name: err?.name,
    cause: err?.cause?.message,
    stack: err?.stack,
    details: err?.details || null,
    ...extra,
  });
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

async function callGroqVisionLLM(messages, model = VISION_MODEL, options = {}) {
  const credential = pickStageCredential("vision", options.affinity, options.keySlot);
  const client = getGroqClient(credential.apiKey, VISION_TIMEOUT_MS);

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: VISION_MAX_TOKENS,
    });

    const content = normalizeMessageContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      const error = new Error("Invalid Groq response");
      error.details = { body: truncateForLog(completion) };
      throw error;
    }

    return content;
  } catch (err) {
    console.error("[Groq Vision] request failed", {
      message: err?.message || String(err),
      name: err?.name,
      status: err?.status,
      cause: err?.cause?.message,
      stack: err?.stack,
      model,
      slot: credential.slotLabel,
      poolSize: credential.poolSize,
    });
    throw err;
  }
}

// ------------------------------
// 1. Text LLM via Groq
// ------------------------------
async function callGroqTextLLM(messagesOrPrompt, model = TEXT_MODEL, options = {}) {
  const stage = options.stage || "generation";
  const credential = pickStageCredential(stage, options.affinity, options.keySlot);
  const maxCompletionTokens = Math.max(256, Math.min(
    Number(options.maxCompletionTokens || GROQ_MAX_COMPLETION_TOKENS),
    GROQ_MAX_COMPLETION_TOKENS
  ));
  const messages = Array.isArray(messagesOrPrompt)
    ? messagesOrPrompt
    : [{ role: "user", content: String(messagesOrPrompt) }];

  const requestBody = {
    model,
    messages,
    max_completion_tokens: maxCompletionTokens,
    temperature: GROQ_TEMPERATURE,
  };

  const client = getGroqClient(credential.apiKey, options.timeoutMs || GROQ_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    console.log(`[Groq Text] stage=${stage} model=${model} timeoutMs=${options.timeoutMs || GROQ_TIMEOUT_MS} slot=${credential.slotLabel}/${credential.poolSize}`);
    console.log(`[Groq Text] outgoing=${truncateForLog(requestBody, 800)}`);
    const completion = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: maxCompletionTokens,
      temperature: GROQ_TEMPERATURE,
    });

    const content = normalizeMessageContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      const error = new Error("Invalid Groq text response");
      error.details = { body: truncateForLog(completion, 1200) };
      throw error;
    }

    console.log(`[Groq Text] success stage=${stage} model=${model} durationMs=${Date.now() - startedAt} slot=${credential.slotLabel}`);
    return content;
  } catch (err) {
    logFetchError("Groq Text", err, {
      model,
      stage,
      slot: credential.slotLabel,
      poolSize: credential.poolSize,
      durationMs: Date.now() - startedAt,
      timeoutMs: options.timeoutMs || GROQ_TIMEOUT_MS,
    });
    throw err;
  }
}
// ------------------------------
// 2. Universal LLM router
// ------------------------------
/**
 * callLLM accepts either a plain string or a messages array and always routes
 * text generation through Groq.
 */
export async function callLLM(promptOrMessages, model = TEXT_MODEL, options = {}) {
  console.log(`[LLM Router] stage=${options.stage || "generation"} model=${model} render=${Boolean(process.env.RENDER)}`);
  return await callGroqTextLLM(promptOrMessages, model, options);
}




export const CAD_MLLM_PLAN_PROMPT = `CAD-MLLM planning pass:
1. Classify the requested shape and extract editable parameters.
2. Decompose the model into revolve, loft, sweep, extrude, shell, boolean, fillet, chamfer, or pattern subtasks.
3. Retrieve matching cad_knowledge, cad_pruning_table, cad_memory, dataset examples, and FeatureScript snippets for each subtask.
4. Prefer command-sequence style construction: solved sketch/profile first, then a downstream solid operation.
5. Emit a short ordered plan with operation, parameters, validation rules, and fallback template for each subtask.`;

export const CAD_MLLM_EXECUTE_PROMPT = `CAD-MLLM execution pass:
Use retrieved examples and pruning rules to write one complete FeatureScript 2931 file.
Expose all user-editable dimensions in precondition, call skSolve before downstream operations, use real Line axes for revolves, use profileSubqueries for opLoft, use connected edge paths for opSweep, validate the static rules, repair once if needed, then return compile-safe FeatureScript only.`;

function stripJson(text) {
  const m = text?.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : (text || "{}")).trim();
}

function promptRequestsAxialHole(prompt = "") {
  return /\b(bore|through hole|center hole|centre hole|axial hole|hole down the center|hole down the centre|hollow|inner diameter|\bid\b|hole on (the )?top|hole in the top|top hole)\b/i.test(prompt);
}

function promptRequestsBlindTopHole(prompt = "") {
  const mentionsTopHole = /\b(hole on (the )?top|hole in the top|top hole|blind hole|blind bore|counterbore)\b/i.test(prompt);
  const mentionsThroughHole = /\b(through hole|bore through|pass through|through bore|hollow|inner diameter)\b/i.test(prompt);
  return mentionsTopHole && !mentionsThroughHole;
}

function inferShapeFromPrompt(prompt = "") {
  const text = normalizeText(prompt).toLowerCase();
  const shapeHints = [
    ["ROBOT_MECH", /\b(robot|robotic|mech|mecha|android|humanoid)\b/],
    ["GEAR_SPUR", /\b(gear|spur|pinion|teeth|tooth|diametral pitch|pressure angle|involute)\b/],
    ["FLANGE", /\b(flange|bolt circle|bolt hole|hub|mount|coupling flange)\b/],
    ["LINKAGE", /\b(linkage|linkage arm|connecting rod|coupler|arm|lever|clevis|tie rod|rod end)\b/],
    ["WASHER", /\b(washer|ring magnet|ring|shim|spacer disk)\b/],
    ["CYLINDER", /\b(wheel|roller|cylinder|rod|shaft|pipe|tube|dowel|pin|post|standoff|magnet)\b/],
    ["BOX", /\b(box|block|cube|rectangular|bar magnet)\b/],
    ["CONE", /\b(carrot|cone|frustum|tapered|nozzle|funnel)\b/],
    ["POLYGON", /\b(hex|hexagon|triangle|polygon|octagon|pentagon|n-sided)\b/],
  ];
  return shapeHints.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function promptNeedsHighFidelityModel(prompt = "") {
  return /\b(organic|realistic|carrot|freeform|smooth|curved|spline|loft|sweep|sculpt|detailed|gear|involute|helical|complex)\b/i.test(prompt);
}

function contentPartToText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return String(part ?? "");
  if (part.type === "text") return part.text || "";
  if (part.type === "image_url") return `[image: ${part.image_url?.url ? "attached" : "missing"}]`;
  return JSON.stringify(part);
}

function messagesToPrompt(messages = []) {
  return messages.map(message => {
    const role = String(message?.role || "user").toUpperCase();
    const content = Array.isArray(message?.content)
      ? message.content.map(contentPartToText).join("\n")
      : contentPartToText(message?.content);
    return `${role}:\n${content}`;
  }).join("\n\n");
}

async function chat(messages, model = TEXT_MODEL, fallbackModels = null, options = {}) {
  const fallbackList = Array.isArray(fallbackModels)
    ? fallbackModels
    : (model === TEXT_MODEL ? [FALLBACK_MODEL] : []);
  const modelsToTry = [model, ...fallbackList.filter(candidate => candidate && candidate !== model)];

  let lastError = null;
  for (const candidate of modelsToTry) {
    try {
      const text = await callLLM(messages, candidate, options);
      if (candidate !== model) console.warn(`[AI] Used fallback model ${candidate} for stage=${options.stage || "generation"}`);
      return text;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || "");
      if (/rate limit|tokens per minute|tpm|429/i.test(message) && options.retryOnRateLimit !== false) {
        const waitMs = Number(options.rateLimitBackoffMs || 1200);
        console.warn(`[AI] Rate limit on stage=${options.stage || "generation"} model=${candidate}; retrying after ${waitMs}ms with next fallback when available.`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastError || new Error("All Groq model calls failed.");
}

// ─── FeatureScript building blocks ───────────────────────────────────────────
//
// Key FeatureScript rules baked in here, not left to the AI:
//   - isLength(definition.foo, BOUNDS) in precondition → gives user an editable slider
//   - definition.foo in body already has Length type — do NOT multiply by * inch
//   - sketch circles + extrude are the most reliable path for cylinders with bores
//   - fCylinder takes: context, id, { bottomCenter, topCenter, radius }
//   - newSketchOnPlane for user-selected planes, not newSketch
//   - skSolve() after all sketch entities, before any opExtrude

function n(x) { return parseFloat(Number(x).toFixed(6)).toString(); }

function preconditionPlane() {
  return `        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;`;
}

function preconditionLength(paramName, label, min, def, max) {
  const defaultExpr = `${n(Math.min(Math.max(def, min), max))} * inch`;
  return `        annotation { "Name" : "${label}", "Default" : "${defaultExpr}" }
        isLength(definition.${paramName}, LENGTH_BOUNDS);`;
}

function preconditionInteger(paramName, label, min, def, max) {
  const defaultValue = Math.min(Math.max(Math.round(def || min), min), max);
  return `        annotation { "Name" : "${label}" }
        isInteger(definition.${paramName}, { (unitless) : [${min}, ${defaultValue}, ${max}] } as IntegerBoundSpec);`;
}

function preconditionDegrees(paramName, label, min, def, max) {
  return preconditionInteger(paramName, label, min, Math.round(Number(def) || min), max);
}

function planeVar() {
  return `        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });`;
}

function fsPoint(xExpr, yExpr, zExpr = null) {
  if (zExpr === null) {
    return `vector((${xExpr}) / inch, (${yExpr}) / inch) * inch`;
  }
  return `vector((${xExpr}) / inch, (${yExpr}) / inch, (${zExpr}) / inch) * inch`;
}


/*

This part is all the pre made template that is soon to be removed or jnust added to the database


_____________________________________________________________________________________________________________________

*/

function tRobotMech(d) {
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("width",  "Overall Width",  1, d.widthInches || 12, 96),
      preconditionLength("height", "Overall Height", 1, d.heightInches || 12, 96),
      preconditionLength("depth",  "Block Depth",    0.1, d.depthInches || 6, 48),
      d.filletRadiusInches > 0
        ? preconditionLength("fillet", "Fillet Radius", 0, d.filletRadiusInches, 4)
        : "",
    ].filter(Boolean).join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        // Blocky mech silhouette: head, torso, arms, legs, and feet as separate cuboid regions.
        skRectangle(sketch1, "head", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.14", "definition.height * 0.30")},
            "secondCorner" : ${fsPoint(" definition.width * 0.14", "definition.height * 0.50")}
        });
        skRectangle(sketch1, "torso", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.22", "-definition.height * 0.08")},
            "secondCorner" : ${fsPoint(" definition.width * 0.22", " definition.height * 0.28")}
        });
        skRectangle(sketch1, "leftUpperArm", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.44", " definition.height * 0.04")},
            "secondCorner" : ${fsPoint("-definition.width * 0.26", " definition.height * 0.24")}
        });
        skRectangle(sketch1, "rightUpperArm", {
            "firstCorner"  : ${fsPoint("definition.width * 0.26", " definition.height * 0.04")},
            "secondCorner" : ${fsPoint("definition.width * 0.44", " definition.height * 0.24")}
        });
        skRectangle(sketch1, "leftForearm", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.50", "-definition.height * 0.18")},
            "secondCorner" : ${fsPoint("-definition.width * 0.32", " definition.height * 0.02")}
        });
        skRectangle(sketch1, "rightForearm", {
            "firstCorner"  : ${fsPoint("definition.width * 0.32", "-definition.height * 0.18")},
            "secondCorner" : ${fsPoint("definition.width * 0.50", " definition.height * 0.02")}
        });
        skRectangle(sketch1, "leftLeg", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.18", "-definition.height * 0.44")},
            "secondCorner" : ${fsPoint("-definition.width * 0.04", "-definition.height * 0.10")}
        });
        skRectangle(sketch1, "rightLeg", {
            "firstCorner"  : ${fsPoint("definition.width * 0.04", "-definition.height * 0.44")},
            "secondCorner" : ${fsPoint("definition.width * 0.18", "-definition.height * 0.10")}
        });
        skRectangle(sketch1, "leftFoot", {
            "firstCorner"  : ${fsPoint("-definition.width * 0.28", "-definition.height * 0.50")},
            "secondCorner" : ${fsPoint("-definition.width * 0.02", "-definition.height * 0.42")}
        });
        skRectangle(sketch1, "rightFoot", {
            "firstCorner"  : ${fsPoint("definition.width * 0.02", "-definition.height * 0.50")},
            "secondCorner" : ${fsPoint("definition.width * 0.28", "-definition.height * 0.42")}
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrudeBlocks", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });${d.filletRadiusInches > 0 ? `
        opFillet(context, id + "filletBlocks", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "extrudeBlocks", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius"   : definition.fillet
        });` : ""}`,
  };
}

function tBox(d) {
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("width",  "Width",    0.01, d.widthInches,   48),
      preconditionLength("height", "Height",   0.01, d.heightInches,  48),
      preconditionLength("depth",  "Depth",    0.01, d.depthInches,   48),
      d.filletRadiusInches > 0
        ? preconditionLength("fillet", "Fillet Radius", 0, d.filletRadiusInches, 4)
        : "",
    ].filter(Boolean).join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "rect1", {
            "firstCorner"  : vector(-definition.width / (2 * inch), -definition.height / (2 * inch)) * inch,
            "secondCorner" : vector( definition.width / (2 * inch),  definition.height / (2 * inch)) * inch
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });${d.filletRadiusInches > 0 ? `
        opFillet(context, id + "fillet1", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "extrude1", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius"   : definition.fillet
        });` : ""}`,
  };
}

function tCylinder(d) {
  const boreDefault = d.holeRadiusInches > 0
    ? Math.min(d.holeRadiusInches, Math.max(0.01, d.radiusInches * 0.45))
    : 0;
  const blindTopHole = d.topHoleMode === "blind_top";
  const holeDepthDefault = Math.max(0.05, Math.min(d.holeDepthInches || d.depthInches * 0.6 || 0.5, d.depthInches || 1));
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("radius", "Radius",  0.01, d.radiusInches, 24),
      preconditionLength("height", "Height",  0.01, d.depthInches,  48),
      `        annotation { "Name" : "Hole Radius", "Default" : "${n(Math.max(0, boreDefault))} * inch" }
        isLength(definition.holeRadius, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);`,
      blindTopHole
        ? preconditionLength("holeDepth", "Top Hole Depth", 0.01, holeDepthDefault, Math.max(1, d.depthInches || 1))
        : "",
    ].join("\n"),
    body: `${planeVar()}
        var hasBore = definition.holeRadius > 0 * inch && definition.holeRadius < definition.radius;
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.radius });
        if (hasBore && ${blindTopHole ? "false" : "true"})
        {
            skCircle(sketch1, "inner", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        }
        skSolve(sketch1);
        var cylEntities = hasBore && ${blindTopHole ? "false" : "true"} ? qSketchRegion(id + "sketch1", true) : qSketchRegion(id + "sketch1");
        opExtrude(context, id + "extrude1", {
            "entities"  : cylEntities,
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.height
        });${blindTopHole ? `
        if (hasBore)
        {
            var topHolePlane = plane(skPlane.origin + skPlane.normal * definition.height, skPlane.normal, skPlane.x);
            var holeSketch = newSketchOnPlane(context, id + "holeSketch", { "sketchPlane" : topHolePlane });
            skCircle(holeSketch, "topHole", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
            skSolve(holeSketch);
            opExtrude(context, id + "topHoleCut", {
                "entities"      : qSketchRegion(id + "holeSketch"),
                "direction"     : -skPlane.normal,
                "endBound"      : BoundingType.BLIND,
                "endDepth"      : definition.holeDepth,
                "operationType" : NewBodyOperationType.REMOVE
            });
        }` : ""}`,
  };
}

function tPolygon(d) {
  const sides = Math.max(3, Math.round(d.sides || 6));
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("circumradius", "Circumradius", 0.01, d.radiusInches, 24),
      preconditionLength("depth", "Depth", 0.01, d.depthInches, 48),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "poly1", {
            "center"      : vector(0, 0) * inch,
            "firstVertex" : vector(1, 0) * definition.circumradius,
            "sides"       : ${sides}
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });`,
  };
}

function tLinkage(d) {
  const holeR = d.holeRadiusInches > 0 ? d.holeRadiusInches : d.widthInches * 0.18;
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("length",    "Total Length",     0.1, d.shaftLengthInches || d.widthInches * 3, 48),
      preconditionLength("width",     "Bar Width",        0.05, d.widthInches, 12),
      preconditionLength("thickness", "Thickness",        0.01, d.depthInches, 4),
      preconditionLength("holeRadius","Pin Hole Radius",  0.01, holeR, 4),
    ].join("\n"),
    body: `${planeVar()}
        var holeOffset = definition.length * 0.5 - definition.holeRadius * 2.5;
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "body", {
            "firstCorner"  : vector(-definition.length / (2 * inch), -definition.width / (2 * inch)) * inch,
            "secondCorner" : vector( definition.length / (2 * inch),  definition.width / (2 * inch)) * inch
        });
        skCircle(sketch1, "holeL", { "center" : vector(-1, 0) * holeOffset, "radius" : definition.holeRadius });
        skCircle(sketch1, "holeR", { "center" : vector( 1, 0) * holeOffset, "radius" : definition.holeRadius });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });`,
  };
}

function tPlateHoles(d) {
  const num = Math.max(2, Math.round(d.numHoles || 4));
  const holeR = d.holeRadiusInches || 0.2;
  const sp    = d.holeSpacingInches || d.widthInches / (num + 1);
  let circles = "";
  for (let i = 0; i < num; i++) {
    const x = n(-((num - 1) * sp) / 2 + i * sp);
    circles += `\n        skCircle(sketch1, "hole${i+1}", { "center" : vector(${x}, 0) * inch, "radius" : definition.holeRadius });`;
  }
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("width",      "Width",       0.1, d.widthInches,      48),
      preconditionLength("height",     "Height",      0.1, d.heightInches,     48),
      preconditionLength("depth",      "Thickness",   0.01, d.depthInches,     4),
      preconditionLength("holeRadius", "Hole Radius", 0.01, holeR,             4),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "plate", {
            "firstCorner"  : vector(-definition.width  / (2 * inch), -definition.height / (2 * inch)) * inch,
            "secondCorner" : vector( definition.width  / (2 * inch),  definition.height / (2 * inch)) * inch
        });${circles}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });`,
  };
}

function tLBracket(d) {
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("armWidth",   "Arm Width",  0.1, d.widthInches,      24),
      preconditionLength("armHeight",  "Arm Height", 0.1, d.heightInches,     24),
      preconditionLength("length",     "Length",     0.1, d.depthInches,      48),
      preconditionLength("wall",       "Wall Thickness", 0.01, d.wallThicknessInches, 2),
    ].join("\n"),
    body: `${planeVar()}
        // Divide lengths by inch to get unitless scalars for vector coordinates.
        // vector(a, b) * inch re-attaches the unit — this is the correct FS pattern.
        var awv = definition.armWidth  / inch;
        var ahv = definition.armHeight / inch;
        var wtv = definition.wall      / inch;
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        // Closed 6-segment L-profile (clockwise from origin):
        // (0,0)→(aw,0)→(aw,wt)→(wt,wt)→(wt,ah)→(0,ah)→(0,0)
        skLineSegment(sketch1, "s1", { "start" : vector(0,   0  ) * inch, "end" : vector(awv, 0  ) * inch });
        skLineSegment(sketch1, "s2", { "start" : vector(awv, 0  ) * inch, "end" : vector(awv, wtv) * inch });
        skLineSegment(sketch1, "s3", { "start" : vector(awv, wtv) * inch, "end" : vector(wtv, wtv) * inch });
        skLineSegment(sketch1, "s4", { "start" : vector(wtv, wtv) * inch, "end" : vector(wtv, ahv) * inch });
        skLineSegment(sketch1, "s5", { "start" : vector(wtv, ahv) * inch, "end" : vector(0,   ahv) * inch });
        skLineSegment(sketch1, "s6", { "start" : vector(0,   ahv) * inch, "end" : vector(0,   0  ) * inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.length
        });`,
  };
}

function tFlange(d) {
  const num  = Math.max(2, Math.round(d.numHoles || 4));
  const bR   = d.holeRadiusInches || 0.25;
  const boltR = d.radiusInches * 0.75;
  let holes = `\n        skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.boreRadius });`;
  for (let i = 0; i < num; i++) {
    const ang = (2 * Math.PI * i) / num;
    holes += `\n        skCircle(sketch1, "bh${i+1}", { "center" : vector(${n(boltR * Math.cos(ang))}, ${n(boltR * Math.sin(ang))}) * inch, "radius" : definition.holeRadius });`;
  }
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("outerRadius", "Outer Radius", 0.1, d.radiusInches, 24),
      preconditionLength("boreRadius",  "Bore Radius",  0.01, bR * 2, 12),
      preconditionLength("holeRadius",  "Bolt Hole Radius", 0.01, bR, 4),
      preconditionLength("thickness",   "Thickness",    0.01, d.depthInches, 4),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "disk", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });${holes}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });`,
  };
}

function tHexNut(d) {
  const circumR = d.widthInches / Math.sqrt(3);
  const holeR   = d.holeRadiusInches || d.widthInches * 0.22;
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("acrossFlats", "Across Flats", 0.05, d.widthInches, 8),
      preconditionLength("thickness",   "Thickness",    0.01, d.depthInches, 4),
      preconditionLength("boreRadius",  "Bore Radius",  0.01, holeR, 4),
    ].join("\n"),
    body: `${planeVar()}
        var circumR = definition.acrossFlats / sqrt(3);
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "hex", { "center" : vector(0, 0) * inch, "firstVertex" : vector(1, 0) * circumR, "sides" : 6 });
        skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.boreRadius });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });`,
  };
}

function tWasher(d) {
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("outerRadius", "Outer Radius", 0.01, d.radiusInches, 12),
      preconditionLength("innerRadius", "Inner Radius", 0.01, d.holeRadiusInches || d.radiusInches * 0.4, 12),
      preconditionLength("thickness",   "Thickness",    0.001, d.depthInches || 0.1, 2),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skCircle(sketch1, "inner", { "center" : vector(0, 0) * inch, "radius" : definition.innerRadius });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });`,
  };
}

function tBushing(d) {
  const innerR = d.holeRadiusInches || d.radiusInches * 0.6;
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("outerRadius", "Outer Radius", 0.01, d.radiusInches, 12),
      preconditionLength("innerRadius", "Inner Radius", 0.01, innerR, 12),
      preconditionLength("length",      "Length",       0.01, d.depthInches, 24),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skCircle(sketch1, "inner", { "center" : vector(0, 0) * inch, "radius" : definition.innerRadius });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.length
        });`,
  };
}

// Hitch Peg: cylindrical shaft + hemispherical dome on top
// Uses opSphere approximated via a revolved semicircle on a construction plane --------------- CHange this should not be a template
function tHitchPeg(d) {
  const shaftR = d.widthInches / 2 || 0.125;   // shaft radius
  const headR  = d.radiusInches   || 0.208;    // dome radius
  const shaftH = d.depthInches    || 0.5;      // shaft height
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("shaftRadius", "Shaft Radius",  0.01, shaftR, 4),
      preconditionLength("shaftHeight", "Shaft Height",  0.01, shaftH, 12),
      preconditionLength("headRadius",  "Head Radius",   0.01, headR,  4),
    ].join("\n"),
    body: `${planeVar()}
        // Shaft
        fCylinder(context, id + "shaft", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * definition.shaftHeight,
            "radius"        : definition.shaftRadius
        });
        // Dome head — revolved semicircle centred at top of shaft
        var domePlane = plane(skPlane.origin + skPlane.normal * definition.shaftHeight, skPlane.normal, skPlane.x);
        var domeSketch = newSketchOnPlane(context, id + "domeSketch", { "sketchPlane" : domePlane });
        skLineSegment(domeSketch, "axis",  { "start" : vector(0, 0) * inch, "end" : vector(0, 1) * definition.headRadius });
        skArc(domeSketch, "dome", {
            "start" : vector(0, 1) * definition.headRadius,
            "mid"   : vector(1, 0) * definition.headRadius,
            "end"   : vector(0, -1) * definition.headRadius
        });
        skLineSegment(domeSketch, "base", { "start" : vector(0, -1) * definition.headRadius, "end" : vector(0, 0) * inch });
        skSolve(domeSketch);
        opRevolve(context, id + "dome", {
            "entities"  : qSketchRegion(id + "domeSketch"),
            "axis"      : line(skPlane.origin + skPlane.normal * definition.shaftHeight, skPlane.normal),
            "angleForward" : 2 * PI * radian
        });
        opBoolean(context, id + "merge", {
            "tools"         : qCreatedBy(id + "dome", EntityType.BODY),
            "targets"       : qCreatedBy(id + "shaft", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });`,
  };
}

// ── CONE / FRUSTUM / TAPERED ─────────────────────────────────────────────────
// Covers: cone, funnel, nozzle, tapered shaft tip, carrot-approximation (frustum).
function tCone(d) {
  const botR = Math.max(0.05, d.radiusInches || d.widthInches / 2 || 0.5);
  const topR = Math.max(0, d.holeRadiusInches || 0);
  const ht   = Math.max(0.05, d.heightInches || d.depthInches || 2.0);
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("bottomRadius", "Base Radius",          0.01, botR, 24),
      preconditionLength("topRadius",    "Top Radius (0 = tip)", 0,    topR, 24),
      preconditionLength("height",       "Height",               0.01, ht,   48),
    ].join("\n"),
    body: `${planeVar()}
        var bRv = definition.bottomRadius / inch;
        var tRv = definition.topRadius    / inch;
        var htv = definition.height       / inch;
        var profileSketch = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
        skLineSegment(profileSketch, "axis", { "start" : vector(0,   0  ) * inch, "end" : vector(0,   htv) * inch });
        skLineSegment(profileSketch, "base", { "start" : vector(0,   0  ) * inch, "end" : vector(bRv, 0  ) * inch });
        skLineSegment(profileSketch, "side", { "start" : vector(bRv, 0  ) * inch, "end" : vector(tRv, htv) * inch });
        skLineSegment(profileSketch, "top",  { "start" : vector(tRv, htv) * inch, "end" : vector(0,   htv) * inch });
        skSolve(profileSketch);
        var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
        opRevolve(context, id + "cone", {
            "entities"     : qSketchRegion(id + "profile"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });`,
  };
}

// ── STEPPED SHAFT ─────────────────────────────────────────────────────────────
function tSteppedShaft(d) {
  const r1 = Math.max(0.05, d.radiusInches || 0.5);
  const r2 = Math.max(0.02, r1 * 0.6);
  const h1 = Math.max(0.05, d.depthInches || 1.0);
  const h2 = Math.max(0.05, h1 * 0.6);
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("radius1", "Large Radius",       0.01, r1, 12),
      preconditionLength("radius2", "Small Radius",       0.01, r2, 12),
      preconditionLength("length1", "Large Section",      0.01, h1, 48),
      preconditionLength("length2", "Small Section",      0.01, h2, 48),
    ].join("\n"),
    body: `${planeVar()}
        fCylinder(context, id + "seg1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * definition.length1,
            "radius"        : definition.radius1
        });
        fCylinder(context, id + "seg2", {
            "bottomCenter"  : skPlane.origin + skPlane.normal * definition.length1,
            "topCenter"     : skPlane.origin + skPlane.normal * (definition.length1 + definition.length2),
            "radius"        : definition.radius2
        });
        opBoolean(context, id + "join", {
            "tools"         : qCreatedBy(id + "seg2", EntityType.BODY),
            "targets"       : qCreatedBy(id + "seg1", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });`,
  };
}

// ── PIPE ─────────────────────────────────────────────────────────────────────
function tPipe(d) {
  const outerR = Math.max(0.1, d.radiusInches || 0.5);
  const wallT  = Math.max(0.01, d.wallThicknessInches || outerR * 0.2);
  const len    = Math.max(0.1, d.shaftLengthInches || d.depthInches || 4.0);
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("outerRadius",   "Outer Radius",   0.01,  outerR, 24),
      preconditionLength("wallThickness", "Wall Thickness", 0.005, wallT,   4),
      preconditionLength("length",        "Length",         0.01,  len,   120),
    ].join("\n"),
    body: `${planeVar()}
        var innerR = definition.outerRadius - definition.wallThickness;
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skCircle(sketch1, "inner", { "center" : vector(0, 0) * inch, "radius" : innerR });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.length
        });`,
  };
}


// Spur gear with involute tooth profile

function templateSpurGearFixed(d) {
  const teeth  = Math.max(8, Math.round(d.numTeeth || 20));
  // moduleInches: standard mechanical module converted to inches (2mm ≈ 0.0787")
  const mod    = d.moduleInches > 0 ? d.moduleInches : 0.0787402;
  const pitchR = mod * teeth / 2;
  const addR   = pitchR + mod;                           // addendum (tip) radius
  const dedR   = Math.max(mod * 0.5, pitchR - 1.25 * mod); // dedendum (root) radius
  const faceW  = d.depthInches > 0 ? d.depthInches : mod * 8;
  const boreR  = d.holeRadiusInches || 0;

  const TAU  = 2 * Math.PI;
  const ta   = TAU / teeth;   // angular pitch (radians per tooth)
  const frac = 0.38;          // tooth half-angle as fraction of angular pitch

  // Returns a FeatureScript vector literal for point (r, angle)
  const vStr = (r, a) =>
    `vector(${n(Math.cos(a) * r)}, ${n(Math.sin(a) * r)}) * inch`;

  let segs = [];
  for (let i = 0; i < teeth; i++) {
    const center = i * ta;
    // Root-land: from previous tooth's right flank to this tooth's left flank
    const aGapStart   = center - ta * (1 - frac);   // = (i-1)*ta + frac*ta  (periodic)
    const aGapEnd     = center - ta * frac;
    // Tooth flanks and tip
    const aTipLeft    = center - ta * frac * 0.5;
    const aTipRight   = center + ta * frac * 0.5;
    const aFlankRight = center + ta * frac;

    const si = i * 4;
    segs.push(`skLineSegment(sketch1, "g${si+0}", { "start" : ${vStr(dedR, aGapStart)},   "end" : ${vStr(dedR, aGapEnd)}   });`);
    segs.push(`skLineSegment(sketch1, "g${si+1}", { "start" : ${vStr(dedR, aGapEnd)},     "end" : ${vStr(addR, aTipLeft)}  });`);
    segs.push(`skLineSegment(sketch1, "g${si+2}", { "start" : ${vStr(addR, aTipLeft)},    "end" : ${vStr(addR, aTipRight)} });`);
    segs.push(`skLineSegment(sketch1, "g${si+3}", { "start" : ${vStr(addR, aTipRight)},   "end" : ${vStr(dedR, aFlankRight)} });`);
    // Note: tooth[i] aFlankRight == tooth[i+1] aGapStart  (mod 2π) → sketch closes ✓
  }

  const indent  = '        ';
  const segStr  = segs.map(s => indent + s).join('\n');
  const boreStr = boreR > 0
    ? `\n${indent}skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : ${n(boreR)} * inch });`
    : '';

  return `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
${segStr}${boreStr}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"${boreR > 0 ? ', true' : ''}),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${n(faceW)} * inch
        });`;
}

function tGear(d) {
  const defaultTeeth = Math.max(8, Math.round(d.numTeeth || 20));
  const defaultPitchRadius = d.pitchRadius || d.radiusInches || ((d.moduleInches || 0.0787402) * defaultTeeth / 2);
  const defaultBoreRadius = d.boreRadius || d.holeRadiusInches || 0.2;
  const defaultFaceWidth = d.faceWidth || d.depthInches || 0.5;
  const gearBody = templateSpurGearFixed({
    ...d,
    numTeeth: defaultTeeth,
    depthInches: defaultFaceWidth,
    holeRadiusInches: defaultBoreRadius,
    moduleInches: d.moduleInches || 0.0787402,
  });

  return {
    precondition: [
      preconditionPlane(),
      preconditionInteger("numTeeth", "Number of Teeth", 6, defaultTeeth, 200),
      preconditionLength("pitchRadius", "Pitch Radius", 0.1, defaultPitchRadius, 24),
      preconditionLength("boreRadius", "Bore Radius", 0, defaultBoreRadius, 12),
      preconditionLength("faceWidth", "Face Width", 0.05, defaultFaceWidth, 24),
    ].join("\n"),
    body: `${planeVar()}
        var pitchRadius = definition.pitchRadius;
        var faceWidth = definition.faceWidth;
        var boreRadius = definition.boreRadius;
${gearBody
  .replace(`${planeVar()}\n`, "")
  .replace(/\bmod\s*=\s*d\.moduleInches > 0 \? d\.moduleInches : 0\.0787402;/, 'mod = (2 * (pitchRadius / inch)) / max(1, definition.numTeeth);')
  .replace(new RegExp(`${n(defaultPitchRadius)} \\* inch`, "g"), "pitchRadius")
  .replace(new RegExp(`${n(defaultBoreRadius)} \\* inch`, "g"), "boreRadius")
  .replace(new RegExp(`${n(defaultFaceWidth)} \\* inch`, "g"), "faceWidth")}`,
  };
}

// ─── Assemble full FeatureScript file ───────────────────────────────────────── CHANGE THIS, THIS CAN BE USED AS A EXAMPLE NOT THE FINAL RESULT

function buildFeatureScript(d) {
  let template;
  switch (d.shape) {
    case "ROBOT_MECH":  template = tRobotMech(d);  break;
    case "CYLINDER":    template = tCylinder(d);    break;
    case "PLATE":       template = tBox(d);         break;
    case "POLYGON":     template = tPolygon(d);     break;
    case "LINKAGE":     template = tLinkage(d);     break;
    case "PLATE_HOLES": template = tPlateHoles(d);  break;
    case "L_BRACKET":
    case "T_BRACKET":   template = tLBracket(d);    break;
    case "FLANGE":      template = tFlange(d);      break;
    case "HEX_NUT":       template = tHexNut(d);       break;
    case "WASHER":        template = tWasher(d);       break;
    case "BUSHING":       template = tBushing(d);      break;
    case "HITCH_PEG":     template = tHitchPeg(d);    break;
    case "CONE":          template = tCone(d);         break;
    case "STEPPED_SHAFT": template = tSteppedShaft(d); break;
    case "PIPE":          template = tPipe(d);         break;
    case "GEAR_SPUR":   template = tGear(d);        break;
    case "BOX":
    default:
      if (d.holeRadiusInches > 0) {
        // box with a center hole — use plate with a single hole in sketch
        const modified = { ...d, numHoles: 1, holeSpacingInches: 0 };
        template = tPlateHoles(modified);
      } else {
        template = tBox(d);
      }
  }

  const name  = (d.featureName  || "aiShape").replace(/[^a-zA-Z0-9_]/g, "");
  const label = (d.featureLabel || "AI Shape").replace(/"/g, "'");

  return `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${label}" }
export const ${name} = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
${template.precondition}
    }
    {
${template.body}
    });
`;
}
// dleete this later this 
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "into", "from", "make", "build",
  "create", "using", "inch", "inches", "mm", "part", "feature", "featurescript",
  "model", "needs", "need", "have", "has", "like", "able", "user", "adjust",
  "dimension", "dimensions", "change", "changes", "thing", "shape"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLearningContext(learningContext = {}) {
  return {
    ...learningContext,
    prompt: String(learningContext.prompt || ""),
    notes: Array.isArray(learningContext.notes) ? [...learningContext.notes] : [],
    examples: Array.isArray(learningContext.examples) ? [...learningContext.examples] : [],
    knowledge: Array.isArray(learningContext.knowledge) ? [...learningContext.knowledge] : [],
    featureScriptDocs: Array.isArray(learningContext.featureScriptDocs) ? [...learningContext.featureScriptDocs] : [],
  };
}


// delete this later, the model can already do this
function extractPromptKeywords(prompt, limit = 6) {
  const words = normalizeText(prompt)
    .toLowerCase()
    .match(/[a-z0-9_]+/g) || [];
  return [...new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word)))].slice(0, limit);
}

function summarizeDimsForPrompt(dims) {
  return JSON.stringify({
    shape: dims.shape,
    confidence: dims.confidence,
    widthInches: dims.widthInches,
    heightInches: dims.heightInches,
    depthInches: dims.depthInches,
    radiusInches: dims.radiusInches,
    holeRadiusInches: dims.holeRadiusInches,
    filletRadiusInches: dims.filletRadiusInches,
    pressureAngleDegrees: dims.pressureAngleDegrees,
    sides: dims.sides,
    wallThicknessInches: dims.wallThicknessInches,
    shaftLengthInches: dims.shaftLengthInches,
    holeSpacingInches: dims.holeSpacingInches,
    numHoles: dims.numHoles,
    numTeeth: dims.numTeeth,
    topHoleMode: dims.topHoleMode,
    holeDepthInches: dims.holeDepthInches,
  });
}
// delete this later, the model can do this later
function summarizeFeatureScript(code, maxLines = 12) {
  return normalizeText(
    String(code || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, maxLines)
      .join(" ")
  );
}

function compactFeaturePattern(code, maxChars = 1600) {
  const normalized = String(code || "").replace(/\r/g, "").trim();
  if (!normalized) return "";
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n...` : normalized;
}
// Thinking 
function buildLearningContextText(learningContext = {}) {
  const lines = [];
  const notes = Array.isArray(learningContext.notes) ? learningContext.notes : [];
  const knowledge = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const featureScriptDocs = Array.isArray(learningContext.featureScriptDocs) ? learningContext.featureScriptDocs : [];
  const gearReference = USE_VALIDATED_TEMPLATES
    ? knowledge.find(entry => normalizeText(entry.memory_type || entry.memoryType || "").toLowerCase().includes("fs_example")
      && /gear/i.test(String(entry.title || "")))
    : null;

  if (notes.length) {
    lines.push("Project-specific guidance from prior runs:");
    notes.forEach((note, index) => lines.push(`${index + 1}. ${normalizeText(note)}`));
  }

  if (featureScriptDocs.length) {
    lines.push("FeatureScript documentation to apply first:");
    featureScriptDocs.slice(0, 4).forEach((entry, index) => {
      const title = normalizeText(entry.title || `Doc ${index + 1}`);
      const source = normalizeText(entry.source || "local FS docs");
      const text = normalizeText(entry.text || "").slice(0, 520);
      lines.push(`${index + 1}. ${title} (${source})`);
      if (text) lines.push(`   ${text}`);
    });
    lines.push("Use these docs as the source of truth for syntax, API usage, and operation ordering.");
  } else {
    // No indexed FS docs on disk — inject core FeatureScript syntax reference inline.
    lines.push("FeatureScript core syntax reference (use these rules as ground truth):");
    lines.push(`1. Feature structure: export const name = defineFeature(function(context is Context, id is Id, definition is map) precondition { ... } { ... });`);
    lines.push(`2. Length params: annotation { "Name": "Label", "Default": "1 * inch" } isLength(definition.param, LENGTH_BOUNDS); — in the body, definition.param already carries Length; never multiply by * inch again.`);
    lines.push(`3. Integer params in FS 2931 require a bounds map: annotation { "Name": "Count", "Default": "20" } isInteger(definition.count, {(unitless) : [1, 20, 200]});`);
    lines.push(`4. Degrees and other dimensionless dialog values should also use isInteger bounds. Do not write definition.x is number; or separate >= / <= lines in the precondition.`);
    lines.push(`5. Plane selection: annotation { "Name": "Plane", "Filter": GeometryType.PLANE, "MaxNumberOfPicks": 1 } definition.location is Query;`);
    lines.push(`   In body: var skPlane = isQueryEmpty(context, definition.location) ? plane(WORLD_ORIGIN, Z_DIRECTION) : evPlane(context, { "face": definition.location });`);
    lines.push(`6. Sketches: var sk = newSketchOnPlane(context, id + "sk1", { "sketchPlane": skPlane }); — then add entities — then ALWAYS call skSolve(sk); before any opExtrude/opRevolve.`);
    lines.push(`7. Vector coords: vector(x, y) * inch where x and y are unitless numbers (divide a Length by inch to get a number: definition.width / inch).`);
    lines.push(`8. opExtrude: opExtrude(context, id + "ext1", { "entities": qSketchRegion(id + "sk1"), "direction": skPlane.normal, "endBound": BoundingType.BLIND, "endDepth": definition.depth });`);
    lines.push(`9. fCylinder(context, id + "cyl1", { "bottomCenter": skPlane.origin, "topCenter": skPlane.origin + skPlane.normal * definition.height, "radius": r });`);
    lines.push(`10. opBoolean: opBoolean(context, id + "bool1", { "tools": qCreatedBy(id+"body1", EntityType.BODY), "targets": qCreatedBy(id+"body2", EntityType.BODY), "operationType": BooleanOperationType.UNION });`);
    lines.push(`11. Remove helper variables that are computed but never used if they do not affect the final geometry.`);
    lines.push(`12. Lambdas inside feature body MUST use const: const fn = function(x is number) { return x * 2; }; — named typed functions (function foo(...) { }) are ONLY legal at module top-level.`);
  }

  if (knowledge.length) {
    lines.push("CAD modeling knowledge to apply:");
    const visibleKnowledge = knowledge
      .filter(entry => {
        const memoryType = normalizeText(entry.memory_type || entry.memoryType || "").toLowerCase();
        if (!memoryType.includes("fs_example")) return true;
        return /gear/i.test(String(entry.title || "")) && /gear/i.test(String(learningContext.prompt || ""));
      })
      .slice(0, 6);
    visibleKnowledge.forEach((entry, index) => {
      const title = normalizeText(entry.title || `Knowledge ${index + 1}`);
      const summary = normalizeText(entry.summary || "").slice(0, 150);
      const hints = Array.isArray(entry.parameter_hints || entry.parameterHints) ? (entry.parameter_hints || entry.parameterHints) : [];
      const notesList = Array.isArray(entry.modeling_notes || entry.modelingNotes) ? (entry.modeling_notes || entry.modelingNotes) : [];
      const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      const failureModes = Array.isArray(entry.failure_modes || entry.failureModes) ? (entry.failure_modes || entry.failureModes) : [];
      const validationRules = Array.isArray(entry.validation_rules || entry.validationRules) ? (entry.validation_rules || entry.validationRules) : [];
      const memoryType = normalizeText(entry.memory_type || entry.memoryType || "");
      const quality = Number.isFinite(Number(entry.quality_score)) ? Number(entry.quality_score).toFixed(2) : "";
      const allowPattern = /gear/i.test(String(entry.title || "")) || !normalizeText(entry.memory_type || entry.memoryType || "").toLowerCase().includes("fs_example");
      const featurePattern = allowPattern ? normalizeText(entry.feature_pattern || entry.featurePattern || "").slice(0, 420) : "";

      lines.push(`${index + 1}. ${title}${summary ? ` — ${summary}` : ""}${memoryType || quality ? ` (${[memoryType, quality && `q=${quality}`].filter(Boolean).join(", ")})` : ""}`);
      if (keywords.length) lines.push(`   keywords=${keywords.slice(0, 6).join(", ")}`);
      if (hints.length) lines.push(`   parameters=${hints.slice(0, 4).map(normalizeText).join(" | ")}`);
      if (notesList.length) lines.push(`   modeling=${notesList.slice(0, 3).map(normalizeText).join(" | ")}`);
      if (featurePattern) lines.push(`   confirmed_pattern=${featurePattern}`);
      if (failureModes.length) lines.push(`   avoid=${failureModes.slice(0, 2).map(normalizeText).join(" | ")}`);
      if (validationRules.length) lines.push(`   validate=${validationRules.slice(0, 2).map(normalizeText).join(" | ")}`);
    });
  }

  if (gearReference) {
    const featurePattern = normalizeText(gearReference.feature_pattern || gearReference.featurePattern || "").slice(0, 520);
    if (featurePattern) {
      lines.push("Gear reference pattern:");
      lines.push(`Use this only as a gear-specific structural reference, not as a generic template: ${featurePattern}`);
    }
  }

  return lines.join("\n").trim();
}
/* This can be delted later */
function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function truncateText(text, maxChars) {
  const normalized = String(text || "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function estimateContextSize(text) {
  return String(text || "").length;
}

function prioritizeLearningContext(context = {}) {
  if (!context || typeof context !== "object") return {};

  const trimmed = {
    ...context,
    featureScriptDocs: Array.isArray(context.featureScriptDocs) ? [...context.featureScriptDocs] : [],
    notes: Array.isArray(context.notes) ? [...context.notes] : [],
    examples: Array.isArray(context.examples) ? [...context.examples] : [],
    knowledge: Array.isArray(context.knowledge) ? [...context.knowledge] : [],
  };

  while (true) {
    const text = buildLearningContextText(trimmed);
    if (estimateContextSize(text) <= GROQ_MAX_PROMPT_CHARS) return trimmed;

    if (trimmed.knowledge.length > 2) {
      trimmed.knowledge = trimmed.knowledge.slice(0, Math.max(1, trimmed.knowledge.length - 1));
      continue;
    }

    if (trimmed.examples.length > 1) {
      trimmed.examples = trimmed.examples.slice(0, 1);
      continue;
    }

    if (trimmed.notes.length > 2) {
      trimmed.notes = trimmed.notes.slice(0, 2);
      continue;
    }

    if (trimmed.featureScriptDocs.length > 3) {
      trimmed.featureScriptDocs = trimmed.featureScriptDocs.slice(0, 3).map(doc => ({
        ...doc,
        text: truncateText(doc.text, 900),
      }));
      continue;
    }

    if (trimmed.featureScriptDocs.length > 1) {
      trimmed.featureScriptDocs = trimmed.featureScriptDocs.slice(0, 2).map(doc => ({
        ...doc,
        text: truncateText(doc.text, 550),
      }));
      continue;
    }

    if (trimmed.notes.length > 0) {
      trimmed.notes = [];
      continue;
    }

    if (trimmed.examples.length > 0) {
      trimmed.examples = [];
      continue;
    }

    if (trimmed.knowledge.length > 0) {
      trimmed.knowledge = [];
      continue;
    }

    return trimmed;
  }
}

function withLearningContext(basePrompt, learningContext) {
  const safeContext = prioritizeLearningContext(learningContext);
  const learningText = buildLearningContextText(safeContext);
  if (!learningText) return basePrompt;
  return `${basePrompt}\n\nDATABASE CONTEXT\n${learningText}`;
}

function makeRequestId(prompt = "") {
  return `${Date.now()}-${stableHash(prompt).toString(36)}`;
}

function safeStageKeyCount(stage) {
  try {
    return getStageKeyPool(stage).length;
  } catch {
    return 0;
  }
}




function buildContextMeta(dims, learningContext = {}) {
  return {
    project: "CAD_AI",
    units: "inch",
    targetPlatform: "Onshape",
    generatorVersion: "nine_key_four_pass_pipeline_v1",
    shape: dims.shape,
    confidence: dims.confidence,
    generationStrategy: GENERATION_STRATEGY,
    validatedTemplates: USE_VALIDATED_TEMPLATES,
    allowTemplateFallback: ALLOW_TEMPLATE_FALLBACK,
    adaptiveExamples: Array.isArray(learningContext.examples) ? learningContext.examples.length : 0,
    adaptiveKnowledge: Array.isArray(learningContext.knowledge) ? learningContext.knowledge.length : 0,
  };
}

function buildKeySlotUsage() {
  return FIXED_KEY_SLOT_SEQUENCE.map((slotLabel, index) => ({
    slotLabel,
    stage: [
      "dimensions",
      "planning",
      "retrieval_db_source",
      "retrieval_dataset",
      "block_synth_candidate_a",
      "block_synth_candidate_b",
      "block_synth_candidate_c",
      "topology_weaver",
      "validation_repair",
    ][index],
  }));
}

function isComplexAssemblyPrompt(prompt = "") {
  return /\b(swerve|module|gearbox|cab|drivetrain|bearing block|fork|motor mount|mounting plate|pulley|belt|chain|wheel fork|cots|assembly|subassembly)\b/i.test(prompt);
}

function traceableRow(row = {}, kind = "knowledge") {
  return {
    kind,
    title: row.title || row.id || "untitled",
    summary: normalizeText(row.summary || row.text || "").slice(0, 240),
    keywords: Array.isArray(row.keywords) ? row.keywords.slice(0, 10) : [],
    source_table: row.source_table || row.sourceTable || kind,
    source_url: row.source_url || row.sourceUrl || null,
    source_type: row.source_type || row.sourceType || null,
    component_tags: row.component_tags || row.componentTags || [],
    operation_tags: row.operation_tags || row.operationTags || [],
    sample_ids: row.sample_ids || row.sampleIds || [],
    score: Number(row._score ?? row.score ?? 0),
  };
}

function scoreTraceableRow(row, keywords = [], stepKeywords = []) {
  const haystack = normalizeText([
    row.title,
    row.summary,
    ...(row.keywords || []),
    ...(row.component_tags || row.componentTags || []),
    ...(row.operation_tags || row.operationTags || []),
    ...(row.tags || []),
  ].join(" ")).toLowerCase();
  const combinedKeywords = uniqueStrings([...(keywords || []), ...(stepKeywords || [])]).map(keyword => keyword.toLowerCase());
  return combinedKeywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function selectTraceableRows(rows = [], keywords = [], stepKeywords = [], limit = 6, kind = "knowledge") {
  return rows
    .map(row => ({ ...traceableRow(row, kind), score: scoreTraceableRow(row, keywords, stepKeywords) }))
    .filter(row => row.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

function selectOperationRows(rows = [], requestedOperations = [], limit = 8) {
  const ops = uniqueStrings((requestedOperations || []).map(operation => normalizeText(operation).toLowerCase()));
  if (!ops.length) return [];
  return rows
    .map(row => {
      const opTags = uniqueStrings([...(row.operation_tags || []), ...(row.operationTags || [])]).map(tag => normalizeText(tag).toLowerCase());
      const summaryText = normalizeText(`${row.title || ""} ${row.summary || ""} ${(row.keywords || []).join(" ")}`).toLowerCase();
      const score = ops.reduce((value, op) => value + (opTags.includes(op) || summaryText.includes(op) ? 1 : 0), 0);
      return { ...traceableRow(row, row.kind || "operation"), score };
    })
    .filter(row => row.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

function summarizeTraceableRows(rows = []) {
  if (!rows.length) return "none";
  return rows
    .map(row => `${row.title} [${row.source_table}]${row.source_url ? ` <${row.source_url}>` : ""}`)
    .join("; ");
}

function compactPromptRows(rows = [], limit = 5) {
  return rows.slice(0, limit).map(row => ({
    title: row.title,
    source_table: row.source_table,
    source_type: row.source_type || null,
    summary: normalizeText(row.summary || "").slice(0, 140),
    keywords: Array.isArray(row.keywords) ? row.keywords.slice(0, 5) : [],
    component_tags: Array.isArray(row.component_tags) ? row.component_tags.slice(0, 4) : [],
    operation_tags: Array.isArray(row.operation_tags) ? row.operation_tags.slice(0, 4) : [],
    sample_ids: Array.isArray(row.sample_ids) ? row.sample_ids.slice(0, 3) : [],
  }));
}

function compactStepMatches(stepMatches = []) {
  return stepMatches.map(step => ({
    stepId: step.stepId,
    dbRows: (step.dbRows || []).slice(0, 3).map(row => row.title),
    datasetRows: (step.datasetRows || []).slice(0, 2).map(row => row.title),
    sourceRows: (step.sourceRows || []).slice(0, 3).map(row => row.title),
  }));
}

function compactBlockCandidateForPrompt(candidate) {
  return {
    candidateId: candidate?.candidateId || null,
    coverage: candidate?.coverage || null,
    missingRequirements: candidate?.missingRequirements || [],
    operationPlan: candidate?.operationPlan
      ? {
          family: candidate.operationPlan.family,
          featureName: candidate.operationPlan.featureName,
          featureLabel: candidate.operationPlan.featureLabel,
          plannedComponents: candidate.operationPlan.plannedComponents || [],
          operationKinds: candidate.operationPlan.operationKinds || [],
          coveredSteps: candidate.operationPlan.coveredSteps || [],
          finishingRequests: candidate.operationPlan.finishingRequests || [],
          warnings: candidate.operationPlan.warnings || [],
          omissions: candidate.operationPlan.omissions || [],
          compilerOptions: candidate.operationPlan.compilerOptions || {},
        }
      : null,
    blocks: Array.isArray(candidate?.blocks)
      ? candidate.blocks.map(block => ({
          stepId: block.stepId,
          name: block.name,
          operation: block.operation,
          dependsOn: block.dependsOn || [],
          bodyPolicy: block.bodyPolicy,
          parametersUsed: block.parametersUsed || [],
          createdQueries: block.createdQueries || [],
          consumedQueries: block.consumedQueries || [],
          validationChecks: block.validationChecks || [],
          fsBlock: String(block.fsBlock || "").slice(0, 1400),
        }))
      : [],
  };
}

function selectedOperationPlanSummary(operationPlan = null) {
  if (!operationPlan) return null;
  return {
    family: operationPlan.family,
    featureName: operationPlan.featureName,
    featureLabel: operationPlan.featureLabel,
    plannedComponents: operationPlan.plannedComponents || [],
    operationKinds: operationPlan.operationKinds || [],
    coveredSteps: operationPlan.coveredSteps || [],
    finishingRequests: operationPlan.finishingRequests || [],
  };
}


function buildCandidateStrategy(candidateId, dims) {
  const strategies = {
    c1: "Prioritize compile-safe, conservative geometry with the simplest valid operation chain.",
    c2: "Lean on retrieved dataset patterns and local FeatureScript references for a closer structural match.",
    c3: "Favor higher-fidelity geometry while staying within FeatureScript 2931 constraints and validator rules.",
  };
  return strategies[candidateId] || `Generate an independent ${dims.shape.toLowerCase()} candidate with diverse modeling choices and full parameter exposure.`;
}


function stripCodeFences(text = "") {
  return String(text || "").replace(/```(?:json|javascript|featurescript)?/gi, "").replace(/```/g, "").trim();
}

function tryParseJson(text, fallback = null) {
  try {
    return JSON.parse(stripJson(stripCodeFences(text)));
  } catch {
    return fallback;
  }
}

function hasBalancedTokens(code = "") {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const stack = [];
  for (const char of String(code || "")) {
    if (pairs[char]) stack.push(pairs[char]);
    else if (Object.values(pairs).includes(char)) {
      const expected = stack.pop();
      if (char !== expected) return false;
    }
  }
  return stack.length === 0;
}

function hasCompileSanity(code = "") {
  const text = String(code || "");
  return hasBalancedTokens(text)
    && /FeatureScript 2931;/.test(text)
    && /defineFeature\s*\(/.test(text)
    && /export const\s+[A-Za-z_]\w*\s*=/.test(text);
}

function hasPreconditionExposure(code = "") {
  return /precondition/.test(code) && /(isLength|isInteger|\sboolean;|\sis Query;)/.test(code);
}

function hasSkSolveBeforeDownstreamOps(code = "") {
  const downstreamMatch = String(code || "").match(/\b(opExtrude|opRevolve|opLoft|opSweep)\b/);
  if (!downstreamMatch) return true;
  const downstreamIndex = downstreamMatch.index ?? -1;
  const skSolveIndex = String(code || "").search(/\bskSolve\s*\(/);
  return skSolveIndex >= 0 && skSolveIndex < downstreamIndex;
}
// delete this later
function humanizeSanitizationRule(rule = "") {
  const labels = {
    remove_typed_lambda_annotations: "removed typed lambda annotations for FeatureScript compatibility",
    replace_length_index: "replaced forbidden array length indexing with a deterministic fixed index",
    normalize_opCylinder_to_fCylinder: "renamed unsupported opCylinder calls to fCylinder",
    insert_skSolve_after_sketch: "inserted skSolve before downstream modeling operations",
    sanitize_qSketchRegion_variable: "normalized qSketchRegion usage to an explicit sketch id",
    repair_pass: "applied an automated repair pass to satisfy validator checks",
  };
  return labels[rule] || `applied automated rule ${rule}`;
}



function normalizeDims(dims) {
  const normalized = {
    featureName: String(dims.featureName || "aiShape").replace(/[^a-zA-Z0-9_]/g, "") || "aiShape",
    featureLabel: String(dims.featureLabel || "AI Shape"),
    shape: String(dims.shape || "CUSTOM"),
    confidence: String(dims.confidence || "MEDIUM").toUpperCase(),
    widthInches: clampNumber(dims.widthInches, 2, 0.01, 240),
    heightInches: clampNumber(dims.heightInches, 2, 0.01, 240),
    depthInches: clampNumber(dims.depthInches, 0.25, 0.01, 240),
    radiusInches: clampNumber(dims.radiusInches, 1, 0.01, 120),
    holeRadiusInches: clampNumber(dims.holeRadiusInches, 0, 0, 120),
    filletRadiusInches: clampNumber(dims.filletRadiusInches, 0, 0, 24),
    pressureAngleDegrees: clampNumber(dims.pressureAngleDegrees, 20, 10, 30),
    sides: Math.max(3, Math.min(16, Math.round(Number(dims.sides) || 6))),
    wallThicknessInches: clampNumber(dims.wallThicknessInches, 0.25, 0.01, 24),
    shaftLengthInches: clampNumber(dims.shaftLengthInches, 4, 0.05, 240),
    holeSpacingInches: clampNumber(dims.holeSpacingInches, 1.5, 0.01, 120),
    numHoles: Math.max(1, Math.min(24, Math.round(Number(dims.numHoles) || 4))),
    numTeeth: Math.max(6, Math.min(200, Math.round(Number(dims.numTeeth) || 20))),
    holeDepthInches: clampNumber(dims.holeDepthInches, 0.5, 0.01, 120),
    topHoleMode: String(dims.topHoleMode || "through"),
    parseFailed: Boolean(dims.parseFailed),
  };

  if (!normalized.featureLabel.trim()) normalized.featureLabel = "AI Shape";
  if (normalized.holeRadiusInches > 0 && ["WASHER", "BUSHING", "CYLINDER"].includes(normalized.shape)) {
    const defaultRatio = normalized.shape === "CYLINDER" ? 0.45 : 0.6;
    if (normalized.holeRadiusInches >= normalized.radiusInches) {
      normalized.holeRadiusInches = Math.max(0.01, normalized.radiusInches * defaultRatio);
    }
  }
  return normalized;
}

function applyPromptHeuristics(prompt, dims) {
  const normalized = { ...dims };
  const inferredShape = inferShapeFromPrompt(prompt);
  const shouldOverrideShape = !normalized.shape || normalized.shape === "CUSTOM" || normalized.confidence === "LOW" || normalized.parseFailed;
  if (shouldOverrideShape && inferredShape) {
    normalized.shape = inferredShape;
  }

  if (isComplexAssemblyPrompt(prompt)) {
    normalized.shape = "CUSTOM";
  }

  if (/\bcarrot\b/i.test(prompt)) {
    normalized.shape = "CONE";
    normalized.radiusInches = Math.max(normalized.radiusInches, 0.75);
    normalized.heightInches = Math.max(normalized.heightInches, 4);
    normalized.depthInches = Math.max(normalized.depthInches, normalized.heightInches);
    normalized.holeRadiusInches = Math.min(normalized.holeRadiusInches, 0.08);
  }

  if (/\b(gear|spur|pinion)\b/i.test(prompt) && !/\bgearbox\b/i.test(prompt)) {
    normalized.shape = "GEAR_SPUR";
    normalized.radiusInches = Math.max(normalized.radiusInches, 1);
    normalized.depthInches = Math.max(normalized.depthInches, 0.4);
    normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.08, normalized.radiusInches * 0.12);
  }

  if (/\b(linkage|linkage arm|connecting rod|coupler|tie rod|rod end)\b/i.test(prompt)) {
    normalized.shape = "LINKAGE";
    normalized.widthInches = Math.max(normalized.widthInches, 0.75);
    normalized.depthInches = Math.max(normalized.depthInches, 0.25);
    normalized.shaftLengthInches = Math.max(normalized.shaftLengthInches, normalized.widthInches * 4, 4);
    normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.12, normalized.widthInches * 0.18);
  }

  if (/\b(robot|robotic|mech|mecha|android|humanoid)\b/i.test(prompt)) {
    normalized.shape = "ROBOT_MECH";
    normalized.widthInches = Math.max(normalized.widthInches, 8);
    normalized.heightInches = Math.max(normalized.heightInches, 8);
    normalized.depthInches = Math.max(normalized.depthInches, 3);
  }

  if (/\bwheel\b/i.test(prompt)) {
    normalized.shape = "CYLINDER";
    normalized.radiusInches = Math.max(normalized.radiusInches, 1.25);
    normalized.depthInches = Math.max(normalized.depthInches, 0.6);
    normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.12, normalized.radiusInches * 0.18);
  }

  if (/\bmagnet\b/i.test(prompt)) {
    if (/\b(bar magnet)\b/i.test(prompt)) {
      normalized.shape = "BOX";
      normalized.widthInches = Math.max(normalized.widthInches, 2);
      normalized.heightInches = Math.max(normalized.heightInches, 0.75);
      normalized.depthInches = Math.max(normalized.depthInches, 0.5);
    } else if (/\b(ring magnet|ring)\b/i.test(prompt)) {
      normalized.shape = "WASHER";
      normalized.radiusInches = Math.max(normalized.radiusInches, 1);
      normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.2, normalized.radiusInches * 0.45);
      normalized.depthInches = Math.max(normalized.depthInches, 0.25);
    } else {
      normalized.shape = "CYLINDER";
      normalized.radiusInches = Math.max(normalized.radiusInches, 0.5);
      normalized.depthInches = Math.max(normalized.depthInches, 0.25);
    }
  }

  if (promptRequestsBlindTopHole(prompt)) {
    normalized.shape = "CYLINDER";
    normalized.topHoleMode = "blind_top";
    normalized.radiusInches = Math.max(normalized.radiusInches, 0.75);
    normalized.depthInches = Math.max(normalized.depthInches, 0.5);
    normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.1, normalized.radiusInches * 0.3);
    normalized.holeDepthInches = Math.min(normalized.depthInches * 0.7, Math.max(0.15, normalized.holeDepthInches || normalized.depthInches * 0.6));
  } else if (promptRequestsAxialHole(prompt)) {
    normalized.holeRadiusInches = normalized.holeRadiusInches > 0 ? normalized.holeRadiusInches : Math.max(0.1, normalized.radiusInches * 0.3);
  }

  return normalizeDims(normalized);
}

/**
 * Geometric Reasoning — linear algebra + engineering heuristics on extracted dims.
 * The output is added to DATABASE CONTEXT so the model understands spatial
 * properties without having to guess from raw numbers alone.
 */

// This should be used as a example for the AI instead of a template, we need to change from AI indefinitying the shape to actually generating the script
function performGeometricReasoning(dims) {
  const hints = [];
  const w = dims.widthInches  || 2;
  const h = dims.heightInches || 2;
  const d = dims.depthInches  || 0.25;
  const r = dims.radiusInches || 0;
  const maxDim = Math.max(w, h, d);
  const minDim = Math.min(w, h, d);

  // ── 1. Bounding-box diagonal (3D Euclidean magnitude) ──────────────────────
  const diag = Math.sqrt(w * w + h * h + d * d);
  hints.push(`bbox_diag=${diag.toFixed(3)}in`);

  // Check for potential Aspect Ratio extremes (Slenderness)
  if (maxDim > 0 && minDim > 0 && (maxDim / minDim) > 20) {
    hints.push("GEOM_WARNING: Extreme aspect ratio detected. Consider reinforcing with ribs or increasing wall thickness.");
  }

  // ── 2. Dominant axis + aspect classification ──────────────────────────────
  const slenderness = maxDim / Math.max(minDim, 0.001);
  const profile =
    slenderness > 8  ? "highly_slender_rod" :
    slenderness > 4  ? "slender_extrusion" :
    slenderness > 2  ? "moderate_extrusion" :
    d < 0.5 && slenderness > 1.5 ? "thin_plate" :
                       "equi_block";
  hints.push(`profile=${profile} slenderness=${slenderness.toFixed(2)}`);

  // ── 3. Volume and surface-area estimates for wall-thickness guidance ───────
  let volume = w * h * d;
  let surfaceArea = 2 * (w * h + w * d + h * d);

  if (["CYLINDER", "BUSHING", "WASHER", "HITCH_PEG"].includes(dims.shape) && r > 0) {
    volume = Math.PI * r * r * d;
    surfaceArea = 2 * Math.PI * r * (r + d);
  }
  const compactness = volume / Math.max(surfaceArea, 0.001); // lower = thinner walls
  hints.push(`vol=${volume.toFixed(3)}in³ sa=${surfaceArea.toFixed(3)}in² compact=${compactness.toFixed(3)}`);

  // ── 4. Topological genus (hole count → number of through-loops) ───────────
  const genus = dims.numHoles > 0 ? dims.numHoles : (dims.holeRadiusInches > 0 ? 1 : 0);
  if (genus > 0) hints.push(`genus=${genus}_through_holes`);

  // ── 5. Wall-thickness safety ratio ────────────────────────────────────────
  const wt = dims.wallThicknessInches || 0;
  if (wt > 0) {
    const minSpan = Math.min(w, h);
    const wtRatio = wt / Math.max(minSpan, 0.001);
    const wtClass =
      wtRatio < 0.05  ? "dangerously_thin" :
      wtRatio < 0.10  ? "thin_walled_check_3d_print_feasibility" :
      wtRatio < 0.25  ? "standard_shell" :
                        "solid_section";
    hints.push(`wall_ratio=${wtRatio.toFixed(3)} class=${wtClass}`);
    
    // Add manufacturing guardrails
    if (wt < 0.04) { // Roughly 1mm
        hints.push("MFG_CONSTRAINT: Wall thickness is below 1mm; recommend increasing for structural integrity.");
    }
  }

  // ── 6. Gear-specific derived geometry ─────────────────────────────────────
  if (dims.shape === "GEAR_SPUR" && dims.numTeeth > 0 && r > 0) {
    const m = (2 * r) / dims.numTeeth;            // module in inches
    const pa = (dims.pressureAngleDegrees || 20) * Math.PI / 180;
    const ra = r + m;
    const rd = Math.max(r - 1.35 * m, r * 0.5);
    const rb = r * Math.cos(pa);
    const faceWidth = dims.depthInches || 0.5;
    const contactRatio = Math.sqrt(ra * ra - rb * rb) / (r * Math.sin(pa));
    hints.push(`gear: module=${(m * 25.4).toFixed(2)}mm tipR=${ra.toFixed(3)}in rootR=${rd.toFixed(3)}in baseR=${rb.toFixed(3)}in contact_ratio~${contactRatio.toFixed(2)} faceW=${faceWidth}in`);
  }

  // ── 7. Structural guidance tag ────────────────────────────────────────────
  const structural =
    profile === "thin_plate"     ? "use_plate_or_sheet_profile" :
    profile.includes("slender")  ? "axial_load_dominant_consider_fCylinder_or_opExtrude" :
    genus > 0                    ? "sketch_holes_before_extrude_not_opBoolean_subtract" :
    wt > 0 && wt < 0.1           ? "keep_wall_thickness_editable_parameter" :
                                   "standard_solid_body";
  hints.push(`structural_hint=${structural}`);

  return hints.join(" | ");
}


// All known shapes that have a validated template — used for emergency fallback only.
// Templates are NEVER the primary output; they are injected as reference examples for the AI.
const TEMPLATE_SHAPES = new Set(["GEAR_SPUR"]);

function canUseTemplateFallback(dims) {
  // Template fallback is a last resort only — never the primary generation path.
  return TEMPLATE_SHAPES.has(dims.shape);
}

/**
 * Build a reference example from the validated template for a given shape.
 * This is injected into the AI's context as a structural example, NOT returned as output.
 * The AI reads it to understand the expected FeatureScript structure and parameter conventions,
 * then generates its own fresh code that implements the user's specific request.
 */
function buildTemplateExampleForDims(dims) {
  if (!TEMPLATE_SHAPES.has(dims.shape)) return null;
  try {
    return buildFeatureScript(dims);
  } catch {
    return null;
  }
}

// Clean and trim the featureScript to prevent errors
//
// FeatureScript spec (toplevel.md): named typed functions like
//   function foo(x is number) returns vector { ... }
// are ONLY legal at module top-level. Inside a feature body (which is a lambda
// passed to defineFeature) only const lambda assignments are allowed:
//   const foo = function(x is number) { ... };
// This function detects rogue named functions inside the feature body and
// converts them to const lambda form so Onshape can parse the file.
function _coreFeatureScriptSanitize(code) {
  let cleaned = String(code || "")
    .replace(/^```[\w-]*\s*/gm, "")
    .replace(/```$/gm, "")
    .replace(/\r/g, "")
    .trim();

  const fsStart = cleaned.indexOf("FeatureScript");
  if (fsStart > 0) {
    cleaned = cleaned.slice(fsStart);
  }

  // ── Basic token repairs ───────────────────────────────────────────────────
  cleaned = cleaned
  // Remove invalid angle keys that models incorrectly add to cylinder/revolve calls.
    .replace(/^\s*"startAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*"endAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    // operationType may be valid on extrude/revolve-style body creators — do NOT strip it
    .replace(/^\s*return\s+[^;{][^;]*;\s*$/gm, "")          // remove value-returning returns in bodies
    .replace(/\bskSpline\s*\(/g, "skFitSpline(")
    .replace(/\bskPolygon\s*\(/g, "skRegularPolygon(")
    .replace(/\bdefinition\.(\w+)\s+is\s+Length\s*;/g, 'isLength(definition.$1, LENGTH_BOUNDS);')
    .replace(/isLength\((definition\.\w+),\s*(\{[\s\S]*?\})\s*\);/g, 'isLength($1, LENGTH_BOUNDS);')
    // Quantity defaults belong in the bound spec for numeric quantity parameters.
    .replace(/(annotation\s*\{\s*"Name"\s*:\s*"[^"]+"\s*),\s*"Default"\s*:\s*"[-0-9.]+"\s*\}(\s*\n\s*isInteger\()/g, '$1 }$2')
    .replace(/isInteger\((definition\.\w+),\s*\{\s*\(unitless\)\s*:\s*\[([^\]]+)\]\s*\}\s*\);/g, 'isInteger($1, { (unitless) : [$2] } as IntegerBoundSpec);')
    // Remove "* inch" multiplied onto a parameter already declared with isLength —
    // those params already carry Length type; multiplying by inch doubles the units.
    .replace(/\b(definition\.\w+)\s*\*\s*inch\b/g, '$1')
    // FeatureScript has no ++ or -- operators. Fix increment/decrement.
    .replace(/\b(\w+)\s*\+\+\s*([;)\]])/g, '$1 += 1$2')
    .replace(/\b(\w+)\s*--\s*([;)\]])/g, '$1 -= 1$2')
    // Strip type annotations from lambda parameters inside feature bodies.
    // "const f = function(x is number, y is map)" → "const f = function(x, y)"
    // This covers `is number`, `is vector`, `is map`, `is array`, `is boolean`, `is string`
    // but must NOT touch `definition.x is Query` or precondition lines.
    .replace(/(\bfunction\s*\([^)]*?)\s+is\s+(number|vector|map|array|boolean|string)\b([^)]*?\))/g,
      (match, before, _type, after) => `${before}${after}`)
    // Repeat up to 3 times for multiple typed params in one lambda
    .replace(/(\bfunction\s*\([^)]*?)\s+is\s+(number|vector|map|array|boolean|string)\b([^)]*?\))/g,
      (match, before, _type, after) => `${before}${after}`)
    .replace(/(\bfunction\s*\([^)]*?)\s+is\s+(number|vector|map|array|boolean|string)\b([^)]*?\))/g,
      (match, before, _type, after) => `${before}${after}`)
    // Repair legacy integer/number preconditions into FS 2931-safe isInteger bounds.
    .replace(
      /isInteger\((definition\.\w+)\)\s*;\s*\n(\s*)\1\s*>=\s*(\d+)\s*;\s*\n\s*\1\s*<=\s*(\d+)\s*;/g,
      (_, param, indent, min, max) => {
        const defaultValue = Math.round((Number(min) + Number(max)) / 2);
        return `${indent}isInteger(${param}, {(unitless) : [${min}, ${defaultValue}, ${max}]});`;
      }
    )
    .replace(
      /definition\.(\w+)\s+is\s+number\s*;\s*\n(\s*)definition\.\1\s*>=\s*(\d+)\s*;\s*\n\s*definition\.\1\s*<=\s*(\d+)\s*;/g,
      (_, name, indent, min, max) => {
        const defaultValue = Math.round((Number(min) + Number(max)) / 2);
        return `${indent}isInteger(definition.${name}, {(unitless) : [${min}, ${defaultValue}, ${max}]});`;
      }
    )
    .replace(/\bisInteger\((definition\.\w+)\)\s*;/g, 'isInteger($1, {(unitless) : [1, 10, 200]});')
    .replace(/\bfunction\s*\(([^)]*?)\bis\s+vector\b([^)]*)\)/g, (_, before, after) => {
      const normalizedBefore = before.replace(/,\s*$/, "").trim();
      const normalizedAfter = after.replace(/^\s*,\s*/, "").trim();
      return `function(${[normalizedBefore, normalizedAfter].filter(Boolean).join(", ")})`;
    })
    .replace(/\bvar\s+([A-Za-z_]\w*)\s*=\s*function\s*\(/g, 'const $1 = function(')
    // ── Restore 'definition is map' in defineFeature signature ────────────────
    // The lambda type-strip replacements above inadvertently remove 'is map' from
    // 'definition is map' because 'map' is in the stripped-types list.
    // 'definition is map' is MANDATORY in the defineFeature signature and must always be present.
    .replace(
      /\bdefineFeature\s*\(\s*function\s*\(\s*context\s+is\s+Context\s*,\s*id\s+is\s+Id\s*,\s*definition\s*\)/g,
      'defineFeature(function(context is Context, id is Id, definition is map)'
    );

  // ── Structural fix: named typed functions inside feature body → const lambdas ──
  // Matches: function name(args) returns type { ... }
  //   or:    function name(args) { ... }
  // when they appear after the opening brace of the feature body (i.e. after
  // the second { in defineFeature(function(...) precondition { } { <HERE> })).
  // Strategy: find the feature body start, then within that region rewrite
  // any top-level named function declarations to const lambda form.
  const featureBodyStart = cleaned.search(/\bdefineFeature\s*\(/);
  if (featureBodyStart !== -1) {
    // Find the body block — it's the second { block after the precondition block
    let depth = 0;
    let inPrecondition = false;
    let preconditionDone = false;
    let bodyOpen = -1;
    let i = featureBodyStart;

    while (i < cleaned.length) {
      const ch = cleaned[i];
      if (cleaned.slice(i, i + 12) === "precondition") {
        inPrecondition = true;
      }
      if (ch === '{') {
        depth++;
        if (inPrecondition && depth === 2) { /* entering precondition block */ }
        else if (inPrecondition && depth === 1) { /* shouldn't happen */ }
        else if (!inPrecondition && !preconditionDone && depth === 2) {
          // This is the feature body opening brace
          bodyOpen = i;
          break;
        }
      }
      if (ch === '}') {
        depth--;
        if (inPrecondition && depth === 1) {
          inPrecondition = false;
          preconditionDone = true;
        }
      }
      i++;
    }

    if (bodyOpen !== -1) {
      // Within the body region, convert named function declarations to const lambdas.
      // Pattern: function <name>(<args>) returns <type> { or function <name>(<args>) {
      const bodyRegion = cleaned.slice(bodyOpen);
      const fixedBody = bodyRegion.replace(
        /\bfunction\s+([a-zA-Z_]\w*)\s*(\([^)]*\))\s*(?:returns\s+\w+\s*)?\{/g,
        (match, name, args) => `const ${name} = function${args}\n        {`
      );
      // Also fix the closing — named functions end with just `}` but lambdas need `};`
      // We do a targeted fix: replace `}\n` that closes a `const X = function` with `};\n`
      const withSemicolons = fixedBody.replace(
        /(const\s+\w+\s*=\s*function[^{]*\{[\s\S]*?)\n(\s*\})\n/g,
        (match, body, closing) => `${body}\n${closing};\n`
      );
      cleaned = cleaned.slice(0, bodyOpen) + withSemicolons;
    }
  }

  // ── Duplicate feature annotation deduplication ────────────────────────────
  const featureAnnotations = [...cleaned.matchAll(/annotation\s*\{\s*"Feature Type Name"\s*:/g)];
  if (featureAnnotations.length > 1) {
    const lastIndex = featureAnnotations[featureAnnotations.length - 1].index;
    cleaned = cleaned.slice(lastIndex);
    if (!cleaned.startsWith("FeatureScript")) {
      cleaned = `FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\n\n${cleaned}`;
    }
  }

  if (cleaned.startsWith("FeatureScript") && !/import\s*\(\s*path\s*:\s*"onshape\/std\//.test(cleaned)) {
    cleaned = cleaned.replace(
      /^FeatureScript\s+\d+\s*;/,
      'FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");'
    );
  }

  if (!cleaned.startsWith("FeatureScript") && /annotation\s*\{\s*"Feature Type Name"\s*:/.test(cleaned)) {
    cleaned = `FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\n\n${cleaned}`;
  }

  const defineFeatureIndex = cleaned.indexOf("defineFeature(");
  if (defineFeatureIndex !== -1) {
    let parenDepth = 0;
    let seenOpen = false;
    let endIndex = -1;
    for (let i = defineFeatureIndex; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === "(") {
        parenDepth++;
        seenOpen = true;
      } else if (ch === ")") {
        parenDepth--;
        if (seenOpen && parenDepth === 0) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      let trimAt = endIndex + 1;
      while (trimAt < cleaned.length && /\s/.test(cleaned[trimAt])) trimAt++;
      if (cleaned[trimAt] === ";") trimAt++;
      const trailing = cleaned.slice(trimAt).trim();
      if (trailing) cleaned = cleaned.slice(0, trimAt).trim();
    }
  }

  return cleaned.trim();
}

/**
 * sanitizeFeatureScript
 * - Applies the core FS sanitization, then deterministic logged transformations.
 * - Returns { code: string, changes: Array<{rule, beforeSnippet, afterSnippet}> }
 *
 * Note: keep transformations conservative and log every change for traceability.
 */
function sanitizeFeatureScript(rawCode, opts = {}) {
  const arrFixedIndexMap = opts.arrFixedIndexMap || {}; // optional mapping for known arrays
  const changes = [];
  // First run through the existing comprehensive sanitizer
  let code = _coreFeatureScriptSanitize(rawCode);

  function record(rule, before, after) {
    changes.push({ rule, beforeSnippet: before.slice(0, 300), afterSnippet: after.slice(0, 300) });
  }

  // 1) Remove typed lambda annotations: function(x is number, y is number) -> function(x, y)
  const typedLambdaRegex = /function\s*\(\s*([a-zA-Z0-9_$]+)\s+is\s+[a-zA-Z0-9_]+\s*(?:,\s*[a-zA-Z0-9_$]+\s+is\s+[a-zA-Z0-9_]+\s*)*\)/g;
  code = code.replace(typedLambdaRegex, (match, _firstParam, offset) => {
    const prefix = code.slice(Math.max(0, offset - 40), offset);
    if (/defineFeature\s*\(\s*$/.test(prefix)) {
      return match;
    }
    const before = match;
    const after = match.replace(/\s+is\s+[a-zA-Z0-9_]+/g, '');
    if (before !== after) record('remove_typed_lambda_annotations', before, after);
    return after;
  });

  // 2) Replace dynamic .length indexing patterns when safe to do so
  // Pattern: arr[arr.length - N] -> arr[<computed_index>] using arrFixedIndexMap or fallback heuristic
  const lengthIndexRegex = /\b([a-zA-Z0-9_]+)\s*\[\s*\1\.length\s*-\s*([0-9]+)\s*\]/g;
  code = code.replace(lengthIndexRegex, (match, arr, nStr) => {
    const n = Number(nStr);
    const fallbackIndex = (arrFixedIndexMap[arr] !== undefined) ? arrFixedIndexMap[arr] : Math.max(0, 6 - n);
    const before = match;
    const after = `${arr}[${fallbackIndex}]`;
    record('replace_length_index', before, after);
    return after;
  });

  // 3) Normalize legacy opCylinder calls to the documented primitive name fCylinder.
  code = code.replace(/\bopCylinder\s*\(/g, (match) => {
    record('normalize_opCylinder_to_fCylinder', match, 'fCylinder(');
    return 'fCylinder(';
  });

  // 4) Ensure skSolve present before downstream ops (best-effort insertion)
  try {
    const sketchCreateRegex = /(\bvar\s+([a-zA-Z0-9_$]+)\s*=\s*newSketch(?:OnPlane)?\s*\([^;]*\);?)/g;
    let sketchMatches = [];
    let m;
    while ((m = sketchCreateRegex.exec(code)) !== null) {
      sketchMatches.push({ full: m[1], varName: m[2], index: m.index });
    }
    if (sketchMatches.length) {
      sketchMatches.reverse(); // process from bottom to top to keep indices valid
      for (const s of sketchMatches) {
        const varName = s.varName;
        const afterSketch = code.slice(s.index + s.full.length);
        const hasSkSolve = new RegExp(`skSolve\\s*\\(\\s*${varName}\\s*\\)`).test(afterSketch);
        const hasDownstreamOp = /(opExtrude|opRevolve|opLoft|opSweep)/.test(afterSketch);
        if (hasDownstreamOp && !hasSkSolve) {
          const insertion = `\n// AUTO-INSERTED: ensure sketch solved before downstream ops\nskSolve(${varName});\n`;
          const insertPos = s.index + s.full.length;
          code = code.slice(0, insertPos) + insertion + code.slice(insertPos);
          record('insert_skSolve_after_sketch', s.full, insertion.trim());
        }
      }
    }
  } catch (e) {
    // never throw; log as change
    record('skSolve_insertion_error', '', `error:${String(e).slice(0, 200)}`);
  }

  // 5) Sanitize qSketchRegion usage: qSketchRegion(sketchVar) -> qSketchRegion("sketch_<id>") best-effort
  const sketchIdMap = new Map();
  const sketchAssignmentRegex = /\bvar\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*newSketch(?:OnPlane)?\s*\(\s*context\s*,\s*(id\s*\+\s*"[^"]+")/g;
  let assignmentMatch;
  while ((assignmentMatch = sketchAssignmentRegex.exec(code)) !== null) {
    sketchIdMap.set(assignmentMatch[1], assignmentMatch[2]);
  }

  const qSketchRegionRegex = /qSketchRegion\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g;
  code = code.replace(qSketchRegionRegex, (match, varName) => {
    const before = match;
    const sketchId = sketchIdMap.get(varName);
    const after = sketchId ? `qSketchRegion(${sketchId})` : `qSketchRegion(id + "${varName}")`;
    record('sanitize_qSketchRegion_variable', before, after);
    return after;
  });

  // 6) Replace hallucinated / non-existent FeatureScript API functions with safe equivalents
  const invalidFunctionReplacements = [
    // opExtrudeBlind → opExtrude (FS has no opExtrudeBlind; the user meant opExtrude with BoundingType.BLIND)
    [/\bopExtrudeBlind\s*\(/g, 'opExtrude(', 'replace_opExtrudeBlind'],
    // opBooleanSub → opBoolean (FS has no opBooleanSub; use opBoolean with BooleanOperationType.SUBTRACTION)
    [/\bopBooleanSub\s*\(/g, 'opBoolean(', 'replace_opBooleanSub'],
    // opBore → not a real FS function; remove entire call (cannot safely rewrite)
    [/\bopBore\s*\([^;]*;\s*/g, '// REMOVED: opBore is not a valid FeatureScript function\n', 'remove_opBore'],
    // opCut → not a real FS function
    [/\bopCut\s*\([^;]*;\s*/g, '// REMOVED: opCut is not a valid FeatureScript function\n', 'remove_opCut'],
    // opPlateHoles → not a real FS function
    [/\bopPlateHoles\s*\([^;]*;\s*/g, '// REMOVED: opPlateHoles is not a valid FeatureScript function\n', 'remove_opPlateHoles'],
    // qEdges → not valid; use qOwnedByBody + qEdgeTopologyFilter pattern
    [/\bqEdges\s*\(/g, 'qOwnedByBody(', 'replace_qEdges'],
    // qEdgeAll → not valid
    [/\bqEdgeAll\s*\(/g, 'qOwnedByBody(', 'replace_qEdgeAll'],
    // qBodyFaces → not valid; use qOwnedByBody
    [/\bqBodyFaces\s*\(/g, 'qOwnedByBody(', 'replace_qBodyFaces'],
    // qAllEdges → not valid
    [/\bqAllEdges\s*\(/g, 'qOwnedByBody(', 'replace_qAllEdges'],
    // evEdgeTopologyFilter → should be qEdgeTopologyFilter
    [/\bevEdgeTopologyFilter\s*\(/g, 'qEdgeTopologyFilter(', 'replace_evEdgeTopologyFilter'],
    // skLine → should be skLineSegment
    [/\bskLine\s*\(/g, 'skLineSegment(', 'replace_skLine'],
    // skSpline → should be skFitSpline (also caught in core sanitizer, but be safe)
    [/\bskSpline\s*\(/g, 'skFitSpline(', 'replace_skSpline'],
    // skPolygon → should be skRegularPolygon
    [/\bskPolygon\s*\(/g, 'skRegularPolygon(', 'replace_skPolygon'],
  ];

  for (const [pattern, replacement, ruleName] of invalidFunctionReplacements) {
    const beforeCode = code;
    code = code.replace(pattern, (match) => {
      record(ruleName, match, typeof replacement === 'string' ? replacement : '(removed)');
      return replacement;
    });
  }

  // 6b) Fix opBoolean calls that came from opBooleanSub: rename singular "tool"/"target" keys
  //     to plural "tools"/"targets" and inject operationType SUBTRACTION if missing.
  code = code.replace(
    /\bopBoolean\s*\(\s*([^,]+),\s*([^,]+),\s*\{([^}]*)\}\s*\)/g,
    (match, ctx, idExpr, argsRaw) => {
      if (!/"tool"\s*:/.test(argsRaw) && !/"target"\s*:/.test(argsRaw)) return match;
      const fixedArgs = argsRaw
        .replace(/"tool"\s*:/g, '"tools" :')
        .replace(/"target"\s*:/g, '"targets" :');
      const hasOpType = /operationType/.test(fixedArgs);
      const after = `opBoolean(${ctx}, ${idExpr}, {${fixedArgs}${hasOpType ? '' : ', "operationType" : BooleanOperationType.SUBTRACTION'}})`;
      record('fix_opBooleanSub_args', match.slice(0, 100), after.slice(0, 100));
      return after;
    }
  );

  // 6c) Fix qOwnedByBody(singleVar) missing EntityType argument — result of replacing
  //     invalid functions like qEdgeAll/qEdges/qBodyFaces/qAllEdges.
  code = code.replace(/\bqOwnedByBody\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g, (match, bodyVar) => {
    const after = `qOwnedByBody(${bodyVar}, EntityType.EDGE)`;
    record('fix_qOwnedByBody_entitytype', match, after);
    return after;
  });

  // 7) Fix opExtrude calls using non-existent key names (profile → entities, distance → endDepth)
  code = code.replace(
    /opExtrude\s*\(\s*([^,]+),\s*([^,]+),\s*\{([^}]*)"profile"\s*:/g,
    (match, ctx, idExpr, prefix) => {
      const after = `opExtrude(${ctx}, ${idExpr}, {${prefix}"entities" :`;
      record('fix_opExtrude_profile_key', match.slice(0, 100), after.slice(0, 100));
      return after;
    }
  );
  code = code.replace(
    /opExtrude\s*\(\s*([^,]+),\s*([^,]+),\s*\{([^}]*)"distance"\s*:/g,
    (match, ctx, idExpr, prefix) => {
      const after = `opExtrude(${ctx}, ${idExpr}, {${prefix}"endDepth" :`;
      record('fix_opExtrude_distance_key', match.slice(0, 100), after.slice(0, 100));
      return after;
    }
  );
  // Fix opExtrude using "sketch" key instead of "entities"
  code = code.replace(
    /opExtrude\s*\(\s*([^,]+),\s*([^,]+),\s*\{([^}]*)"sketch"\s*:/g,
    (match, ctx, idExpr, prefix) => {
      const after = `opExtrude(${ctx}, ${idExpr}, {${prefix}"entities" :`;
      record('fix_opExtrude_sketch_key', match.slice(0, 100), after.slice(0, 100));
      return after;
    }
  );

  // 8) Ensure the file ends with }); — fix missing closing for defineFeature
  const trimmedCode = code.trimEnd();
  if (/\bdefineFeature\s*\(/.test(trimmedCode) && !trimmedCode.endsWith(');')) {
    // Count braces/parens to determine what's missing
    let braceDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < trimmedCode.length; i++) {
      const ch = trimmedCode[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
    }
    let suffix = '';
    while (braceDepth > 0) { suffix += '\n    }'; braceDepth--; }
    while (parenDepth > 0) { suffix += ')'; parenDepth--; }
    if (!suffix.endsWith(';')) suffix += ';';
    // suffix.length > 0 (not > 1) so a lone ';' is also applied (fixes "});  " → "});\n")
    if (suffix.length > 0) {
      code = trimmedCode + suffix + '\n';
      record('fix_truncated_file_ending', '(truncated file)', suffix.trim() || '(added semicolon)');
    }
  }

  return { code, changes };
}

// ─── Dimension extractor ────────────────────────────────────────────────────── CHANGE THIS

const DIM_SYSTEM = `You are a mechanical CAD dimension extractor with engineering knowledge.
Output ONLY a valid JSON object — no markdown, no explanation.

Schema (ALL fields required, use sensible defaults for anything not stated):
{
  "featureName":          "camelCase identifier — no spaces",
  "featureLabel":         "Human readable name",
  "shape":                "see SHAPE LIST, CUSTOM allowed",
  "confidence":           "HIGH | MEDIUM | LOW",
  "widthInches":          2,
  "heightInches":         2,
  "depthInches":          0.25,
  "radiusInches":         1,
  "holeRadiusInches":     0,
  "filletRadiusInches":   0,
  "pressureAngleDegrees": 20,
  "sides":                6,
  "wallThicknessInches":  0.25,
  "shaftLengthInches":    4,
  "holeSpacingInches":    1.5,
  "numHoles":             4,
  "numTeeth":             20
}

SHAPE LIST (choose the closest match — never output "UNKNOWN"):
BOX, ROBOT_MECH, CYLINDER, PLATE, POLYGON, LINKAGE, PLATE_HOLES, L_BRACKET, T_BRACKET,
FLANGE, HEX_NUT, WASHER, BUSHING, HITCH_PEG, GEAR_SPUR,
CONE, STEPPED_SHAFT, PIPE,
CUSTOM

Shape classification:
ROBOT_MECH    — robotic mech, mecha, blocky robot, android, humanoid robot,
                robot made with cubes or cuboids; choose this over BOX if robot/mech appears
BOX           — cube, block, rectangular solid, billet, slab (no holes)
CYLINDER      — solid cylinder, rod, shaft, dowel, pin, post, standoff, peg, boss (no bore unless requested)
                wheel or roller defaults should also map here when no richer wheel-specific template exists
PLATE         — flat plate, sheet, panel (no holes; use PLATE_HOLES if holes present)
POLYGON       — triangle, pentagon, hexagon, N-sided prism; set sides field
LINKAGE       — connecting rod, link bar, rocker arm, crank arm, pitman arm, tie rod,
                coupler, push rod, clevis rod, train link, drive rod, lever arm;
                elongated bar with pin hole at each end
PLATE_HOLES   — mounting plate, bracket face; flat rectangle with multiple holes
L_BRACKET     — L-bracket, angle bracket, shelf bracket, corner bracket
T_BRACKET     — T-bracket, T-plate
FLANGE        — pipe flange, weld flange, bolt flange, circular plate with bolt circle
HEX_NUT       — hex nut, jam nut, lock nut, castle nut
WASHER        — washer, spacer disk, shim, flat ring
                ring magnets should map here as well
BUSHING       — bushing, sleeve, journal bearing, short hollow cylinder (length ≈ diameter)
HITCH_PEG     — hitch peg, mushroom head pin, thumb peg, lollipop pin,
                any pin with a domed or spherical head on a cylindrical shaft
GEAR_SPUR     — spur gear, gear wheel, pinion, drive gear, driven gear,
                any gear described by tooth count or gear ratio
CONE          — cone, frustum, funnel, nozzle, tapered tip, hopper, carrot-shape (approximate),
                any shape that is wide at one end and narrows to a point or smaller circle.
                Use radiusInches for base radius, holeRadiusInches for top radius (0 = sharp tip),
                heightInches for total height.
STEPPED_SHAFT — stepped shaft, shoulder bolt, counter-shaft, transmission shaft, drive shaft,
                any shaft with two or more distinct diameter sections along its axis.
                Use radiusInches for the larger diameter, holeRadiusInches for the smaller,
                depthInches for the larger section length, shaftLengthInches for the smaller.
PIPE          — pipe, tube, hollow tube, conduit, duct, barrel, sleeve — thin-walled cylinder
                where the length is significantly greater than the diameter. Use wallThicknessInches.
CUSTOM        — organic, sculpted, multi-lofted, or geometry that genuinely cannot be approximated
                by any shape above. Use for things like nuts and bolts together, propellers,
                complex bracket assemblies, springs, threads, or true freeform surfaces.

Mechanical engineering defaults:
GEARS — pressure angle 20deg standard; "8:1 ratio" → numTeeth=40, radiusInches=2.5 (8 DP);
        "diametral pitch P, N teeth" → radiusInches = N/(2P);
        default face width = 0.5 * pitch_diameter; bore = 0.3 * pitch_radius
BOLTS — M3=0.118in, M4=0.157in, M5=0.197in, M6=0.236in, M8=0.315in, M10=0.394in;
        #6=0.138in, #8=0.164in, #10=0.190in, 1/4=0.25in, 3/8=0.375in
GEARS — pressure angle is normally 20°, use 14.5° for older gears and 25° for stronger teeth; expose pressure angle when user requests specific tooth form.
HITCH PEG — shaft diameter from widthInches, head radius from radiusInches, shaft height from depthInches
ROBOT MECH — default widthInches=12, heightInches=12, depthInches=6; expose all as editable parameters
CYLINDER WITH HOLE — keep shape as CYLINDER; if no bore is specified, set holeRadiusInches to roughly 30% to 45% of outer radius; never let holeRadiusInches >= radiusInches
CONE/CARROT — use CONE shape (not CUSTOM); set holeRadiusInches=0 for a sharp tip; carrot = tall narrow cone
PIPE vs BUSHING — PIPE when length > 2× outer diameter; BUSHING when length ≤ 2× outer diameter
MAGNETS — bar magnet → BOX, ring magnet → WASHER, otherwise default to CYLINDER unless the prompt clearly asks for a block

Unit rules:
- All output in INCHES. Divide mm by 25.4.
- "diameter X" → radiusInches = X/2
- "across flats X" (hex) → widthInches = X
- "OD X ID Y" → radiusInches = X/2, holeRadiusInches = Y/2
- LINKAGE: shaftLengthInches = total length, widthInches = bar width, depthInches = thickness
- If a prompt says "hole on top", "top hole", "bore", "center hole", or "hollow cylinder", treat that as an axial hole or bore, not a decorative surface mark
- Missing dims: use sensible mechanical defaults, never 0 for main dimensions
- confidence: HIGH if all dims explicit, MEDIUM if some inferred, LOW if mostly guessed`;

async function extractDims(prompt, learningContext = {}, history = [], options = {}) {
  const context = normalizeLearningContext(learningContext);
  const messages = [{ role: "system", content: withLearningContext(DIM_SYSTEM, context) }];

  // Add history to help LLM understand relative changes (e.g. "wider", "taller")
  for (const turn of history.slice(-3)) {
    messages.push({ role: "user", content: turn.prompt });
    messages.push({ role: "assistant", content: JSON.stringify(turn.dims || {}) });
  }

  messages.push({ role: "user", content: prompt.trim() });

  const extractorModel = promptNeedsHighFidelityModel(prompt) ? DIM_MODEL : FAST_MODEL;
  try {
    const raw = await chat(messages, extractorModel, [DIM_MODEL, TEXT_MODEL, FALLBACK_MODEL], {
      stage: "dimensions",
      affinity: options.affinity || options.requestId || makeRequestId(prompt),
      keySlot: "k1",
    });
    const parsed = JSON.parse(stripJson(raw));
    const d = normalizeDims({
      featureName:         String(parsed.featureName         ?? "aiShape").replace(/[^a-zA-Z0-9_]/g,""),
      featureLabel:        String(parsed.featureLabel        ?? "AI Shape"),
      shape:               String(parsed.shape               ?? "CUSTOM"),
      confidence:          String(parsed.confidence          ?? "MEDIUM"),
      widthInches:         Number(parsed.widthInches)        || 2,
      heightInches:        Number(parsed.heightInches)       || 2,
      depthInches:         Number(parsed.depthInches)        || 0.25,
      radiusInches:        Number(parsed.radiusInches)       || 1,
      holeRadiusInches:    Number(parsed.holeRadiusInches)   || 0,
      filletRadiusInches:  Number(parsed.filletRadiusInches) || 0,
      sides:               Number(parsed.sides)              || 6,
      wallThicknessInches: Number(parsed.wallThicknessInches)|| 0.25,
      shaftLengthInches:   Number(parsed.shaftLengthInches)  || 4,
      holeSpacingInches:   Number(parsed.holeSpacingInches)  || 1.5,
      numHoles:            Number(parsed.numHoles)           || 4,
      numTeeth:            Number(parsed.numTeeth)           || 20,
      pressureAngleDegrees: Number(parsed.pressureAngleDegrees) || 20,
      parseFailed: false,
    });
    return d;
  } catch (err) {
    console.warn(`[AI] Dimension extraction fallback used: ${err.message}`);
    return normalizeDims({
      featureName:"customFeature", featureLabel:"Custom Feature", shape:"CUSTOM", confidence:"LOW",
      widthInches:2, heightInches:2, depthInches:2, radiusInches:1,
      holeRadiusInches:0, filletRadiusInches:0, sides:6,
      wallThicknessInches:0.25, shaftLengthInches:4, holeSpacingInches:1.5, numHoles:4, numTeeth:20,
      parseFailed: true,
    });
  }
}

// ─── Thinking trace ───────────────────────────────────────────────────────────

function buildThinkingTrace(prompt, d, meta = {}) {
  const lines = [`Prompt analyzed: "${prompt}"`];
  lines.push(`Shape: ${d.shape}  |  Confidence: ${d.confidence}`);
  const generationLabel =
    meta.generationMode === "multi_key_simplified"
      ? "AI-authored simplified recovery — compile-safe fallback"
      : meta.generationMode === "multi_key_repaired"
      ? "AI-authored repaired result — validator and repair loop applied"
      : meta.generationMode === "gear_template_fallback"
      ? "Gear-specific template fallback — kept only for spur gears"
      : meta.generationMode === "recovery_failed"
      ? "AI-authored partial result — best available code with warnings"
      : meta.generationMode === "four_pass_operation_compiler_partial"
      ? "Hybrid operation compiler — partial result with source-backed omissions"
      : meta.generationMode === "four_pass_operation_compiler"
      ? "Hybrid operation compiler — compile-safe deterministic assembly"
      : meta.generationMode === "template"
        ? "Template output (CI/test override — template_only env)"
        : "AI-authored parametric feature";
  lines.push(`Generation mode: ${generationLabel}`);

  if (meta.templateInjected) {
    lines.push(`Template reference: A validated ${d.shape} template was injected into context as a structural guide.`);
  }

  if (meta.learningExamples) {
    lines.push(`Database context: used ${meta.learningExamples} similar prior generation(s) as guidance.`);
  }

  if (d.shape === "GEAR_SPUR") {
  const m = (2 * d.radiusInches) / d.numTeeth;
  lines.push(`Gear math:`);
  lines.push(`  Teeth: ${d.numTeeth}  Pitch radius: ${d.radiusInches.toFixed(4)} in  Module: ${m.toFixed(4)} in`);
  lines.push(`  Tip radius: ${(d.radiusInches + m).toFixed(4)} in  Root radius: ${Math.max(d.radiusInches - 1.35*m, d.radiusInches*0.5).toFixed(4)} in`);
  lines.push(`  Pressure angle: 20deg standard  |  ${d.numTeeth * 4} sketch entities`);
  lines.push(`  MANDATORY GEAR BUILD: Use involute flank sampling (skFitSpline with involute points computed from base circle), root arc (skArc), tip arc (skArc), circular pattern for all teeth (opPatternCircular), boolean union of tooth + hub bodies, and bore cut.`);
  lines.push(`  NEVER use simple concentric circles for gear teeth — that produces a placeholder, not a valid gear.`);
  } else if (d.shape === "HITCH_PEG") {
    lines.push(`Compound shape: cylindrical shaft + hemispherical dome`);
    lines.push(`  Shaft: radius ${d.widthInches/2} in, height ${d.depthInches} in`);
    lines.push(`  Dome:  radius ${d.radiusInches} in`);
  lines.push(`  Build: fCylinder (shaft) + opRevolve (dome) + opBoolean union`);
  } else if (d.shape === "LINKAGE") {
    const hR = d.holeRadiusInches > 0 ? d.holeRadiusInches : d.widthInches * 0.18;
    lines.push(`  Length: ${d.shaftLengthInches} in  Width: ${d.widthInches} in  Thickness: ${d.depthInches} in`);
    lines.push(`  Pin hole radius: ${hR.toFixed(3)} in (offset ${(d.shaftLengthInches/2 - hR*2.5).toFixed(3)} in from centre)`);
  } else if (d.shape === "ROBOT_MECH") {
    lines.push(`Blocky mech template: separate cuboid head, torso, arms, legs, and feet`);
    lines.push(`  Overall: ${d.widthInches} x ${d.heightInches} x ${d.depthInches} in`);
  } else {
    const parts = [];
    if (["BOX","PLATE"].includes(d.shape)) parts.push(`${d.widthInches} x ${d.heightInches} x ${d.depthInches} in`);
    if (["CYLINDER","BUSHING","WASHER"].includes(d.shape)) parts.push(`radius ${d.radiusInches} in, length ${d.depthInches} in`);
    if (d.holeRadiusInches > 0) parts.push(`hole radius ${d.holeRadiusInches} in`);
    if (d.filletRadiusInches > 0) parts.push(`fillet ${d.filletRadiusInches} in`);
    if (d.shape === "POLYGON") parts.push(`${d.sides} sides, circumradius ${d.radiusInches} in`);
    if (["PLATE_HOLES","FLANGE"].includes(d.shape)) parts.push(`${d.numHoles} holes`);
    if (parts.length) lines.push(`  ${parts.join("  |  ")}`);
    if (d.shape === "CYLINDER" && d.holeRadiusInches > 0) {
      lines.push(`  Strategy: concentric vector-based sketch circles extruded into a tube-style body for a stable center bore.`);
    }
  }

  lines.push(`Output target: parametric FeatureScript with editable dimensions in the Onshape dialog`);
  if (d.confidence === "LOW") {
    lines.push(`Note: Low confidence — dimensions were not stated explicitly and are estimated.`);
  }
  if (meta.customReasoning) {
    lines.push(`Custom model notes: ${normalizeText(meta.customReasoning)}`);
  }
  if (meta.orchestration?.status) {
    lines.push(`Pipeline status: ${meta.orchestration.status}`);
    if (meta.orchestration.failedPass) {
      lines.push(`Failed pass: ${meta.orchestration.failedPass}`);
    }
    if (Array.isArray(meta.orchestration.blockers) && meta.orchestration.blockers.length) {
      lines.push(`Blockers: ${meta.orchestration.blockers.join(" | ")}`);
    }
  }
  return lines.join("\n");
}
// -----------------------------------MAIN PROMPT FOR THE AI--------------------------------------------------------------
export const CAD_MLLM_PLAN_PROMPT_TEMPLATE = `You are the planner in a CAD-MLLM-style CAD generation loop.
Given a user prompt plus optional multimodal descriptors, return a concise JSON plan:
{
  "shapeClass": "organic | loft | sweep | enclosure | flange | hybrid | prismatic | custom",
  "parameters": [{"name":"param","value":"default or parsed value","unit":"inch|degree|unitless|boolean"}],
  "subtasks": [
    {
      "id": "short-id",
      "operation": "revolve | loft | sweep | extrude | shell | fillet | chamfer | boolean | pattern",
      "goal": "what this step creates",
      "retrievalKeywords": ["keywords for cad_knowledge/cad_pruning_table/cad_memory"],
      "validationFocus": ["skSolve", "closed profile", "axis is Line"]
    }
  ],
  "fallbackStrategy": "operation-family compiler or source-backed omission"
}
Prefer explicit decomposition, editable parameters, and robust primitive choices over brittle single-shot geometry.`;

export const CAD_MLLM_EXECUTE_PROMPT_TEMPLATE = `You are the executor in a CAD-MLLM-style FeatureScript generation loop.
Use the plan, retrieved cad_knowledge rows, pruning rules, cad_memory examples, and any multimodal descriptors.
Return only compile-safe FeatureScript 2931 with this invariant set:
- import onshape/std/geometry.fs version 2931.0
- every user-editable value is exposed in precondition using isLength, isInteger, boolean, or Query selection
- every sketch is solved with skSolve before opExtrude/opRevolve/opLoft/opSweep
- opRevolve axis is a Line value, not a Query
- opLoft uses profileSubqueries in ordered profile sketches
- opSweep uses profiles and a connected path query
- no unused helper variables
- if validation fails, repair from pruning rules; if repair still fails, return structured diagnostics or a source-backed omission plan rather than template code.`;

export const FOUR_PASS_DECOMPOSITION_SYSTEM = `You are MODEL KEY [DECOMPOSITION_PLANNER].
Return JSON only.
Break the user's mechanical prompt into a chronological CAD build plan with these fields:
{
  "shapeClass": "prismatic|axisymmetric|assembly|hybrid|custom",
  "assemblyComponents": ["component names"],
  "baseSkeleton": ["planes, axes, offsets, datums"],
  "primaryProfiles": ["major sketches or silhouettes"],
  "materialAddition": ["extrudes, revolves, sweeps, lofts"],
  "materialRemoval": ["cuts, bores, pockets, hollows"],
  "finishing": ["fillets, chamfers, patterns, tolerances"],
  "forbiddenSimplifications": ["things not allowed"],
  "steps": [
    {
      "id": "step_id",
      "name": "step name",
      "operation": "extrude|revolve|loft|sweep|shell|boolean|pattern|fillet|chamfer|cut",
      "goal": "what the step creates",
      "dependsOn": ["prior step ids"],
      "retrievalKeywords": ["keywords"],
      "validationFocus": ["safety checks"],
      "bodyPolicy": "separate|union|subtract"
    }
  ]
}
Rules:
- Complex prompts like swerve modules, cabs, drivetrains, bearing blocks, forked modules, and motor mounts must stay multi-component.
- Do not simplify a complex assembly to one wheel, one block, one cylinder, or one fallback body.
- If dimensions are missing, keep them as retrievable/defaultable parameters rather than inventing hard numbers silently.`;

export const FOUR_PASS_BLOCK_SYNTH_SYSTEM = `You are MODEL KEY [BLOCK_SYNTHESIZER].
Return JSON only.
Generate a compact operation plan, not a full FeatureScript file.
Schema:
{
  "candidateId": "c1",
  "coverageNotes": ["short notes"],
  "missingRequirements": ["missing items"],
  "operationPlan": {
    "family": "simple_box|filleted_box|fillet_chamfer_block|open_top_shell_box|imprinted_box|carrot|mushroom|spur_gear|swerve_module|frc_tube|belt_side_plate|train_cab|custom",
    "featureName": "camelCaseName",
    "featureLabel": "Readable Name",
    "plannedComponents": ["major components"],
    "operationKinds": ["sketch_profile","extrude_add","extrude_remove","revolve_add","sweep_add","loft_add","shell","fillet","chamfer","boolean","pattern"],
    "coveredSteps": ["step ids"],
    "finishingRequests": ["fillet","chamfer","shell"],
    "warnings": ["soft risks"],
    "omissions": ["what may be intentionally omitted"],
    "compilerOptions": { "variant": "short label", "notes": ["source-backed hints"] }
  }
}
Rules:
- Return an operation-family plan the deterministic compiler can assemble.
- Do not output raw FeatureScript statements in this pass.
- Sketches must be solved before downstream operations.
- Revolve axes must be explicit Line values.
- For complex prompts, missing a major subsystem is worse than returning fewer cosmetic details.`;

export const FOUR_PASS_WEAVER_SYSTEM = `You are MODEL KEY [TOPOLOGY_WEAVER].
Return JSON only.
Input contains a decomposition plan, retrieved sources, and a deterministic operation plan candidate.
Review the plan for omissions, finishing safety, and assembly completeness. Do not emit FeatureScript code.
Schema:
{
  "status": "completed|blocked|partial",
  "reasoning": "short explanation",
  "warnings": ["soft risks"],
  "omissions": ["intentionally skipped features"],
  "blockers": ["if blocked"],
  "finishingPlan": {
    "applyShell": true,
    "applyFillet": false,
    "applyChamfer": false,
    "reason": "short explanation"
  }
}
Rules:
- Strongly prefer best-effort completion with omissions over blocking.
- Shell, fillet, and chamfer should only be approved when the supporting solid and stable query strategy are present.
- Only return status "blocked" (with empty code) if the prompt requires a complex multi-body
  assembly AND the operation plan provides no meaningful geometry scaffold whatsoever.`;

export const FOUR_PASS_VALIDATOR_SYSTEM = `You are MODEL KEY [VALIDATION_REPAIR].
Return JSON only.
Review the final weaved FeatureScript and the orchestration trace.
Schema:
{
  "status": "pass|blocked|repair",
  "blockers": ["issues that should block the result"],
  "notes": ["short validation notes"]
}

IMPORTANT: The code has already been sanitized. Strongly prefer "pass" or "repair" over "blocked".
Return "blocked" ONLY when ALL of the following are true simultaneously:
- A complex multi-component assembly COMPLETELY collapsed into a single primitive body
- AND key requested components are entirely absent (not just imperfect)
- AND no repair path exists

Do NOT return "blocked" for ANY of the following — these are auto-fixed by sanitization:
- Missing "as IntegerBoundSpec" on isInteger bounds
- Missing skSolve() calls — the sanitizer inserts them automatically
- Invalid function names (opBooleanSub, qEdgeAll, qEdges, opBore, opCut, etc.)
- Fillet/chamfer edge selection style (qEdgeAll, qBodyFaces, etc.)
- Code truncation or missing closing brackets
- Syntax details that will be repaired in a subsequent pass
- Length values used directly inside vector(...) without / inch conversion
- opExtrude shortcut keys like "profile", "sketch", or "distance"

When in doubt, return "pass" with notes rather than "blocked".`;

const CUSTOM_FEATURE_SYSTEM = ` SYSTEM: You are a strict FeatureScript authoring assistant. Follow these rules exactly:
- Output only valid FeatureScript 2931 code and nothing else unless asked for explanation.
- The exported feature signature must accept a single map parameter named "definition" declared in the precondition. Use isLength/isInteger/boolean/Query as appropriate. Do not emit alternate function signatures (e.g., "function(definition is map)").
- Forbidden constructs: typed lambda parameter annotations (e.g., "is number"), any use of ".length" on arrays, dynamic index expressions like [arr.length - 1], passing Query objects as opRevolve axis, qSketchRegion(sketchVariable), and unsupported opCylinder calls.
- Always include skSolve before any downstream opExtrude/opRevolve/opLoft/opSweep.
- Expose user-editable parameters in the precondition using isLength/isInteger/boolean and sensible bounds.
- For numeric quantity parameters, set the default in the bounds spec. Use IntegerBoundSpec for isInteger instead of string Default annotations.
- Use prompt understanding and retrieved docs/memory to decide the modeling strategy. Do not depend on keyword-template routing.
- If uncertain about an API key or environment, do not reference or output secrets.
- If you must reference an example, only use sanitized examples that follow the above rules.
- If any rule would be violated by the intended output, respond with a short JSON diagnostics object: {"error":"violation","reasons":[...]} and do not emit code.
- Preserve editability: if you expose parameters in precondition, the resulting geometry must actually depend on those definition parameters.

Return ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "featureName": "camelCaseName",
  "featureLabel": "Readable Feature Name",
  "reasoning": "2-3 sentence modeling strategy",
  "code": "complete raw FeatureScript file — no backticks"
}

═══ HOW TO USE REFERENCE EXAMPLES IN DATABASE CONTEXT ═══
When DATABASE CONTEXT contains sanitized FeatureScript examples, use them as operation references only:
1. Extract the safe API pattern and operation order.
2. Rebuild the requested geometry from the user's dimensions and retrieved evidence.
3. Do not copy example code wholesale.

═══ MANDATORY FILE STRUCTURE (HARD CONSTRAINT — DO NOT VIOLATE) ═══\r\nEvery file MUST follow this EXACT structure — the layout and punctuation matter:\r\n\r\n  FeatureScript 2931;\r\n  import(path : "onshape/std/geometry.fs", version : "2931.0");\r\n\r\n  annotation { "Feature Type Name" : "My Feature" }\r\n  export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)\r\n      precondition {\r\n          // parameter declarations here\r\n      }\r\n      {\r\n          // feature body here\r\n      });

═══ STRUCTURE PUNCTUATION RULES (CRITICAL — THESE SYNTAX ERRORS BREAK COMPILATION) ═══
-- defineFeature takes EXACTLY: defineFeature(function(context is Context, id is Id, definition is map)
-- The body BLOCK opens IMMEDIATELY after the closing paren on the SAME LINE with no newline between ) and {
-- The closing MUST be }); with semicolon (NOT just } or ));
-- NEVER split precondition or body opening across lines.

═══ PRECONDITION RULES (from official FS docs) ═══
- Integer parameter (FS 2931 requires the bounds map form):
    annotation { "Name" : "Count", "Default" : "4" }
    isInteger(definition.count, {(unitless) : [1, 4, 100]});
- Degrees and other plain dimensionless dialog values should also use isInteger:
    annotation { "Name" : "Angle (deg)", "Default" : "20" }
    isInteger(definition.angleDeg, {(unitless) : [10, 20, 30]});
    // In the body convert with: definition.angleDeg * PI / 180
- NEVER write:
    isInteger(definition.count);
    definition.count >= 1;
    definition.count <= 100;
- NEVER write:
    definition.angleDeg is number;
- Boolean toggle:
    annotation { "Name" : "Add Bore" }
    definition.addBore is boolean;

═══ FEATURE BODY RULES (from official FS docs) ═══
- Get the sketch plane from the user-selected plane parameter:
    var skPlane = isQueryEmpty(context, definition.location)
        ? plane(WORLD_ORIGIN, Z_DIRECTION)
        : evPlane(context, { "face" : definition.location });
- Create a sketch on that plane:
    var sk = newSketchOnPlane(context, id + "sk1", { "sketchPlane" : skPlane });
- ALWAYS call skSolve before any opExtrude/opRevolve — omitting skSolve means NO geometry appears:
    skSolve(sk);
- Extrude from a solved sketch:
    opExtrude(context, id + "ext1", {
        "entities"  : qSketchRegion(id + "sk1"),
        "direction" : skPlane.normal,
        "endBound"  : BoundingType.BLIND,
        "endDepth"  : definition.depth
    });
- qSketchRegion must reference the sketch id expression, such as qSketchRegion(id + "sk1").
  NEVER pass the sketch variable itself, such as qSketchRegion(sk).
- definition.depth is already a Length value from isLength() — NEVER write definition.depth * inch.
- For cylinders or round parts with a center hole or top bore, prefer one sketch with concentric circles:
    skCircle(sk, "outer", { "center": vector(0, 0) * inch, "radius": definition.radius });
    skCircle(sk, "inner", { "center": vector(0, 0) * inch, "radius": definition.holeRadius });
    skSolve(sk);
    opExtrude(context, id + "ext1", {
        "entities"  : qSketchRegion(id + "sk1", true),
        "direction" : skPlane.normal,
        "endBound"  : BoundingType.BLIND,
        "endDepth"  : definition.height
    });
- NEVER use opCylinder — use fCylinder or sketch plus extrude instead.
  To create a solid cylinder, sketch a circle and extrude it:
    var cylSk = newSketchOnPlane(context, id + "cylSk", { "sketchPlane" : skPlane });
    skCircle(cylSk, "cyl", { "center" : vector(0, 0) * inch, "radius" : definition.radius });
    skSolve(cylSk);
    opExtrude(context, id + "cyl1", {
        "entities"  : qSketchRegion(id + "cylSk"),
        "direction" : skPlane.normal,
        "endBound"  : BoundingType.BLIND,
        "endDepth"  : definition.height
    });
- opRevolve: { "entities": Query, "axis": Line, "angleForward": 2 * PI * radian }
- The revolve axis must be a Line value, not a query. For a profile drawn with radius on sketch X and height on sketch Y, use line(skPlane.origin, cross(skPlane.normal, skPlane.x)).
- Organic tapered shapes like carrots should use a revolved spline profile with at least 4 profile points.
  A 2-point skFitSpline is not enough for a realistic tapered organic shape.
- opBoolean: { "tools": Query, "targets": Query, "operationType": BooleanOperationType.UNION }

═══ FUNCTION SCOPE AND EDITING RULES ═══
1. EDIT MODE: If history is provided, you are EDITING existing code. Do not rewrite everything from scratch. 
   Modify the existing FeatureScript to reflect the new request while keeping valid parameters.
2. SCOPE: The feature body is a LAMBDA. Named top-level functions (function foo(...) {}) are ILLEGAL inside.
   USE: const myFunc = function(x) { ... }; inside the body.
   NEVER use var myFunc = function(...) { ... }; for helper lambdas.
3. UNITS: definition.param is already a Length if declared with isLength. 
   NEVER write: definition.param * inch. This doubles units and fails.
4. The file must end immediately after the exported feature closes with });.
   NEVER append template libraries, helper examples, or backup code after the main feature.

═══ SKETCH API ═══
- skLineSegment(sk, "line1", { "start": vector(0,0) * inch, "end": vector(1,0) * inch });
- skCircle(sk, "circ1", { "center": vector(0,0) * inch, "radius": definition.radius });
- skRectangle(sk, "rect1", { "firstCorner": vector(-w/2,-h/2) * inch, "secondCorner": vector(w/2,h/2) * inch });
  (w and h are plain numbers here — multiply by inch to make them Length vectors)
- skFitSpline(sk, "spline1", { "points": [vector(x1,y1) * inch, vector(x2,y2) * inch, ...] });
- For organic profiles, use 4 to 7 control points with meaningful taper and curvature.
- skRegularPolygon(sk, "poly1", { "center": vector(0,0) * inch, "firstVertex": vector(r,0) * inch, "sides": 6 });
  ("skPolygon" does NOT exist — always use skRegularPolygon)

═══ COMMON MISTAKES TO AVOID ═══
1. Writing "definition.x is Length" in precondition — WRONG. Use isLength(definition.x, LENGTH_BOUNDS).
2. Writing "definition.x * inch" in the body when x is an isLength param — doubles the units, WRONG.
3. Passing qSketchRegion(sk) or qSketchRegion(sketch1) — WRONG. Use qSketchRegion(id + "sk1").
4. Forgetting skSolve(sk) before opExtrude — sketch geometry will not appear without it.
5. Named functions (function foo() {}) inside the feature body — use const lambdas instead.
6. Using "skPolygon" — it does not exist. Use skRegularPolygon.
7. Keeping helper variables that are computed but never used — remove them before returning code.
8. Raw numbers in geometry operations — always attach units: vector(1, 0) * inch, not vector(1, 0).
9. Organic profiles with only two spline points — these collapse into straight or trivial geometry.
10. TYPED LAMBDA PARAMETERS — FeatureScript lambdas inside a feature body CANNOT have type annotations.
    WRONG: const f = function(t is number, rb is number) { ... }
    WRONG: const f = function(p, a is number) { ... }   ← even ONE typed param breaks compilation
    RIGHT: const f = function(t, rb) { ... }
    RIGHT: const f = function(p, a) { ... }
    The error message is: "Error in initializer function arguments" or "missing TOP_SEMI at 'function'"
11. INCREMENT/DECREMENT — FeatureScript has NO ++ or -- operators.
    WRONG: k++   WRONG: i--   → these cause "no viable alternative" parse errors.
    RIGHT: k += 1   RIGHT: i -= 1
12. const INSIDE LOOP BODIES — const is only valid at the top level of the feature body.
    Inside a for/while/if block you MUST use var.
    WRONG: for (var k = 0; ...) { const x = expr; }
    RIGHT: for (var k = 0; ...) { var x = expr; }
13. ARRAY .length — FeatureScript arrays have NO .length property.
    WRONG: arr[arr.length - 1]   → runtime error
    RIGHT: use a known index like arr[5], or track the count with a separate var.
14. Using opCylinder — normalize it to fCylinder or to sketch + extrude.
    WRONG: opCylinder(context, id + "cyl1", { "bottomCenter": ..., ... })
    RIGHT: fCylinder(context, id + "cyl1", { "bottomCenter": ..., "topCenter": ..., "radius": ... })
15. Using definition.param in the body without declaring it in the precondition.
    Every definition.param accessed in the body MUST have a matching isLength / isInteger /
    is boolean / is Query declaration in the precondition block. Missing declarations cause
    runtime "undefined" or type errors.

═══ GEARS / TOOTHED PARTS ═══
- Gear helper lambdas MUST use untyped parameters (rule 10 above):
  RIGHT: const invPoint = function(t, rb) { ... };
  WRONG: const invPoint = function(t is number, rb is number) { ... };
- Never use var for const helper lambdas at the feature body top level; use const.
- Inside for loops over teeth, use var for loop-body temporaries (rule 12 above).
- Tooth sketches must create CLOSED regions before extrusion.
- Keep all user-facing values editable: tooth count, module or pitch radius, face width, pressure angle, and bore.
- Never represent a finished spur gear as only concentric circles for root, pitch, and tip diameters.
- Use sampled involute-style left and right tooth flanks plus tip/root arcs.
- For a gear pair, keep the gears as separate bodies and offset their centers by pitchRadius1 + pitchRadius2.
- Do not boolean-union two different gears together unless the prompt explicitly asks for one merged body.

═══ ADVANCED OPERATIONS ═══
Use these when the shape genuinely needs them — do not force them onto simple geometry.

opLoft — creates a solid by transitioning between two or more profile sketches:
  // Each profile must be a separate sketch on a different plane.
  var sk1 = newSketchOnPlane(context, id + "prof1", { "sketchPlane" : planeA });
  skCircle(sk1, "c", { "center" : vector(0,0)*inch, "radius" : definition.baseRadius });
  skSolve(sk1);
  var sk2 = newSketchOnPlane(context, id + "prof2", { "sketchPlane" : planeB });
  skCircle(sk2, "c", { "center" : vector(0,0)*inch, "radius" : definition.topRadius });
  skSolve(sk2);
  opLoft(context, id + "loft1", {
      "profileSubqueries" : [qSketchRegion(id + "prof1"), qSketchRegion(id + "prof2")]
  });
  // For 3+ profiles, add more entries to "profileSubqueries". Profiles must be in order along the path.
  // NEVER add "sections" or "edges" keys — FS 2931 opLoft uses "profileSubqueries".

opSweep — extrudes a profile sketch along a path sketch:
  // Path sketch: a single open wire (skLineSegment, skArc, or skFitSpline curve)
  var pathSk = newSketchOnPlane(context, id + "path", { "sketchPlane" : skPlane });
  skFitSpline(pathSk, "spine", { "points" : [vector(0,0)*inch, vector(1,0.5)*inch, vector(2,0)*inch] });
  skSolve(pathSk);
  // Profile sketch on a plane perpendicular to the path start
  var profPlane = plane(skPlane.origin, skPlane.x);  // perpendicular to skPlane
  var profSk = newSketchOnPlane(context, id + "prof", { "sketchPlane" : profPlane });
  skCircle(profSk, "c", { "center" : vector(0,0)*inch, "radius" : definition.radius });
  skSolve(profSk);
  opSweep(context, id + "sweep1", {
      "profiles" : qSketchRegion(id + "prof"),
      "path"     : qCreatedBy(id + "path", EntityType.EDGE)
  });

opShell — hollows a solid body, leaving a specified wall thickness:
  // Must be called AFTER the solid body exists (after opExtrude or opRevolve).
  opShell(context, id + "shell1", {
      "entities"  : qCapEntity(id + "extrude1", CapType.END, EntityType.FACE),
      "thickness" : -definition.wallThickness
  });
  // In FS 2931, pass the face(s) to remove/open as entities; do not use an excludeFaces key.

opFillet — rounds selected edges:
  opFillet(context, id + "fillet1", {
      "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body1", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
      "radius"   : definition.filletRadius
  });

opChamfer — bevels selected edges:
  opChamfer(context, id + "cham1", {
      "entities"  : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body1", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
      "chamferType" : ChamferType.EQUAL_OFFSETS,
      "width"     : definition.chamferWidth
  });

Intermediate plane construction — how to make a plane at an offset or angle:
  var offsetPlane = plane(skPlane.origin + skPlane.normal * definition.height, skPlane.normal);
  var sidePlane   = plane(skPlane.origin, skPlane.x);  // perpendicular to sketch plane

═══ GEAR GENERATION RULES (MUST USE INVOLUTE PROFILE) ═══\r\n-- For GEAR_SPUR shapes, you MUST use the full involute flank sampling approach:\r\n-- 1. Compute base circle, pitch circle, root circle, and tip circle radii from:\r\n--    - pitchRadius, pressureAngle, module (module = 2*pitchRadius / numTeeth)\r\n--    - tipRadius = pitchRadius + module\r\n--    - rootRadius = max(pitchRadius - 1.35*module, pitchRadius*0.5)\r\n--    - baseRadius = pitchRadius * cos(pressureAngle)\r\n-- 2. Draw the tooth profile using skArc for root arc, skArc for tip arc, and skFitSpline for involute flank\r\n-- 3. Create ONE tooth profile sketch, then use opPatternCircular with the body as target and axis for pattern\r\n-- 4. Create the hub/body as a cylinder (skCircle + opExtrude) with bore hole\r\n-- 5. UNION the tooth body with the hub body using opBoolean\r\n-- DO NOT use simple concentric circles for gear teeth — that produces a placeholder, not a valid gear.\r\n-- DO NOT use skCircle alone for root/tip without involute spline in between.\r\n-- Every gear must have: involute flank spline, root arc, tip arc, circular pattern, boolean union, bore cut.\r\n\r\n═══ MECH / MULTI-BODY STRATEGY ═══
Mechanical assemblies (mechs, robots, vehicles) are multiple separate bodies on one sketch plane.
Build each section as its own opExtrude call or fCylinder primitive
for cylindrical parts), then union adjacent bodies:

  // Pattern: sketch circle → skSolve → opExtrude for each cylindrical part, then union
  var legSk = newSketchOnPlane(context, id + "legSk", { "sketchPlane" : skPlane });
  skCircle(legSk, "leg1c", { "center" : vector(sideOff, 0) * inch, "radius" : definition.legRadius });
  skSolve(legSk);
  opExtrude(context, id + "leg1", {
      "entities"  : qSketchRegion(id + "legSk"),
      "direction" : skPlane.normal,
      "endBound"  : BoundingType.BLIND,
      "endDepth"  : definition.legLength
  });
  opExtrude(context, id + "foot1", { "entities": qSketchRegion(id + "footSk"), ... });
  opBoolean(context, id + "joinLeg1", {
      "tools": qCreatedBy(id + "foot1", EntityType.BODY),
      "targets": qCreatedBy(id + "leg1", EntityType.BODY),
      "operationType": BooleanOperationType.UNION
  });

For robot/mech shapes:
- Build the torso first as a BOX (opExtrude of a rectangle)
- Add limbs as cylinders (sketch circle + opExtrude) positioned relative to the torso
- Use vector arithmetic for positioning: skPlane.origin + skPlane.normal * offset + skPlane.x * sideOffset
- UNION all parts that should be one body; leave separate bodies as separate if they are distinct parts

═══ ORGANIC SHAPES (CARROTS, ROOTS, PODS, BLOBS) ═══
Use a revolved spline profile for any organic tapered shape:
  var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
  // 5-7 control points on the right side of the axis (x > 0), axis on x=0
  // Taper from wide at bottom to narrow at top for a carrot/root shape
  skLineSegment(sk, "axis", { "start" : vector(0, 0)*inch, "end" : vector(0, htv)*inch });
  skFitSpline(sk, "profile", { "points" : [
      vector(bRv, 0)*inch,
      vector(bRv * 0.9, htv * 0.2)*inch,
      vector(bRv * 0.7, htv * 0.45)*inch,
      vector(bRv * 0.4, htv * 0.7)*inch,
      vector(0.02, htv)*inch
  ] });
  skLineSegment(sk, "top",  { "start" : vector(0.02, htv)*inch, "end" : vector(0, htv)*inch });
  skLineSegment(sk, "base", { "start" : vector(0, 0)*inch, "end" : vector(bRv, 0)*inch });
  skSolve(sk);
  var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
  opRevolve(context, id + "body", {
      "entities"     : qSketchRegion(id + "profile"),
      "axis"         : revolveAxis,
      "angleForward" : 2 * PI * radian
  });
  // The axis line must connect to the profile edges to close the region.
  // A 2-point spline or a simple line is NOT sufficient for realistic organic shapes.


═══ GEAR RULE (HARD CONSTRAINT FOR GEAR_SPUR) ═══
-- When shape is GEAR_SPUR, you MUST produce a complete involute spur gear with:
   1. Base circle, pitch circle, root circle, tip circle radii from pressure angle + module
   2. One tooth profile: skArc (root) + skFitSpline involute flank + skArc (tip)
   3. Circular pattern of the tooth body (opPatternCircular)
   4. Hub/cylinder body with bore — UNIONed with tooth body
   5. Every dimension exposed in precondition for user editing
-- DO NOT use concentric circles alone — they produce a non-compiled placeholder.
═══ GOAL ═══
- Build exactly what the user asked for, with sensible parametric defaults.
- Every parameter must be editable in the Onshape feature dialog.
- Prefer simple, robust geometry over clever but brittle geometry.
- The code must compile and produce visible 3D geometry with zero errors.`;

const MULTI_CANDIDATE_AUTHOR_SYSTEM = `SYSTEM: You are a strict FeatureScript 2931 authoring assistant used inside a multi-key, multi-model CAD orchestration pipeline.
NEVER include, reference, or request API keys, secrets, or internal key identifiers in any output.
Output valid FeatureScript 2931 inside the JSON "code" field only.
The exported feature signature must accept a single map parameter named definition declared in the precondition.
Forbidden constructs: typed lambda parameter annotations, .length on arrays, dynamic index expressions like [arr.length - 1], passing Query objects as opRevolve axis, qSketchRegion(sketchVariable), and unsupported opCylinder usage.
Always include skSolve before opExtrude/opRevolve/opLoft/opSweep.
Expose user-editable parameters in the precondition using isLength/isInteger/boolean/Query with sensible defaults.
For numeric quantity parameters, place default values in the bound spec. Use IntegerBoundSpec for isInteger rather than string Default annotations.
Use only sanitized retrieved snippets and local Omni-CAD summaries provided in the prompt; never invent provenance.
Return JSON only with this schema:
{
  "featureName": "camelCaseFeature",
  "featureLabel": "Human Readable Name",
  "notes": ["short design notes"],
  "code": "full FeatureScript 2931 file"
}`;

function buildRetrievedSnippetsText(snippets = []) {
  if (!snippets.length) return "No retrieved snippets provided.";
  return snippets.map(snippet => `SNIPPET_ID: ${snippet.id}\n${snippet.code}`).join("\n\n");
}



function buildCandidateUserPrompt({
  prompt,
  dims,
  history,
  plan,
  retrievedSnippets,
  omniCadSummary,
  retrievalBriefs,
  candidateId,
  contextMeta,
  tabCitations,
}) {
  const recentHistory = history.slice(-3).map(turn => ({
    prompt: turn.prompt,
    dims: turn.dims,
    code: summarizeFeatureScript(turn.code || "", 10),
  }));

  return [
    `USER REQUEST: ${prompt}`,
    `CONTEXT META: ${JSON.stringify(contextMeta)}`,
    `CANDIDATE ID: ${candidateId}`,
    `CANDIDATE STRATEGY: ${buildCandidateStrategy(candidateId, dims)}`,
    `DIMENSIONS: ${summarizeDimsForPrompt(dims)}`,
    `PLAN: ${JSON.stringify(plan)}`,
    `RETRIEVED_SNIPPETS:\n${buildRetrievedSnippetsText(retrievedSnippets)}`,
    `OMNI_CAD_DATA_SUMMARY: ${omniCadSummary}`,
    `RETRIEVAL_BRIEFS:\n${retrievalBriefs.map(brief => `- ${brief.id}: ${brief.summary}`).join("\n")}`,
    `TAB_CITATIONS: ${JSON.stringify(tabCitations)}`,
    recentHistory.length ? `RECENT HISTORY: ${JSON.stringify(recentHistory)}` : "",
    `Return JSON only: {"featureName":"...","featureLabel":"...","notes":["..."],"code":"..."}`,
  ].filter(Boolean).join("\n\n");
}

function formatSanitizations(changes = []) {
  return changes.map(change => ({
    rule: change.rule,
    before: change.beforeSnippet,
    after: change.afterSnippet,
  }));
}

function evaluateCandidateChecks(code) {
  const validationIssues = validateFeatureScript(code);
  const fatalIssues = hasFatalFeatureScriptPatterns(code);
  return {
    validationIssues,
    fatalIssues,
    checks: {
      precondition: hasPreconditionExposure(code),
      forbidden_patterns: fatalIssues.map(issue => issue.code),
      skSolve_present: hasSkSolveBeforeDownstreamOps(code),
      compile_sanity: hasCompileSanity(code),
    },
  };
}

async function generateStructuredCandidate({
  candidateId,
  prompt,
  dims,
  learningContext,
  history,
  plan,
  retrievedSnippets,
  omniCadSummary,
  retrievalBriefs,
  requestId,
}) {
  const contextMeta = buildContextMeta(dims, learningContext);
  const tabCitations = Array.isArray(learningContext.tabCitations) ? learningContext.tabCitations : [];
  const messages = [
    { role: "system", content: withLearningContext(MULTI_CANDIDATE_AUTHOR_SYSTEM, learningContext) },
    {
      role: "user",
      content: buildCandidateUserPrompt({
        prompt,
        dims,
        history,
        plan,
        retrievedSnippets,
        omniCadSummary,
        retrievalBriefs,
        candidateId,
        contextMeta,
        tabCitations,
      }),
    },
  ];

  const authoringModel = promptNeedsHighFidelityModel(prompt) ? COMPLEX_MODEL : TEXT_MODEL;
  const raw = await chat(messages, authoringModel, [COMPLEX_MODEL, TEXT_MODEL, FALLBACK_MODEL], {
    stage: "generation",
    affinity: `${requestId}:${candidateId}:generation`,
  });
  const parsed = tryParseJson(raw, null);
  const featureName = String(parsed?.featureName || dims.featureName || candidateId).replace(/[^a-zA-Z0-9_]/g, "") || dims.featureName;
  const featureLabel = String(parsed?.featureLabel || dims.featureLabel || "Custom Feature");
  const draftNotes = Array.isArray(parsed?.notes) ? parsed.notes.map(note => normalizeText(note)).filter(Boolean) : [];
  const sanitized = sanitizeFeatureScript(parsed?.code || raw);

  return {
    candidate_id: candidateId,
    featureName,
    featureLabel,
    notes: draftNotes,
    code: sanitized.code,
    sanitizations: formatSanitizations(sanitized.changes),
  };
}




function planFallbackForPrompt(prompt, dims) {
  const complex = isComplexAssemblyPrompt(prompt);
  const baseSteps = complex
    ? [
        {
          id: "skeleton",
          name: "Base skeleton and datums",
          operation: "extrude",
          goal: "Establish reference planes, offsets, and main mounting envelope",
          dependsOn: [],
          retrievalKeywords: extractPromptKeywords(`${prompt} reference planes datums mount`, 8),
          validationFocus: ["editable parameters", "separate bodies", "no simplification"],
          bodyPolicy: "separate",
        },
        {
          id: "primaryBodies",
          name: "Primary structural bodies",
          operation: "extrude",
          goal: "Create the main plates, forks, blocks, or frame members",
          dependsOn: ["skeleton"],
          retrievalKeywords: extractPromptKeywords(`${prompt} frame plate fork block bearing mount`, 10),
          validationFocus: ["closed profile", "skSolve", "separate bodies"],
          bodyPolicy: "separate",
        },
        {
          id: "interfaces",
          name: "Mechanical interfaces",
          operation: "cut",
          goal: "Add bores, hole patterns, bearing seats, and motor or shaft interfaces",
          dependsOn: ["primaryBodies"],
          retrievalKeywords: extractPromptKeywords(`${prompt} shaft bearing bore mounting pattern belt pulley`, 10),
          validationFocus: ["stable cuts", "query safety", "source-backed dimensions"],
          bodyPolicy: "separate",
        },
      ]
    : [
        {
          id: "mainBody",
          name: "Primary body",
          operation: dims.shape === "CONE" ? "revolve" : "extrude",
          goal: "Create the main part volume",
          dependsOn: [],
          retrievalKeywords: extractPromptKeywords(`${prompt} ${dims.shape}`, 8),
          validationFocus: ["skSolve", "editable parameters"],
          bodyPolicy: "separate",
        },
      ];

  const finishingStep = {
    id: "finishing",
    name: "Finishing operations",
    operation: "fillet",
    goal: "Apply only stable finishing operations after solid creation",
    dependsOn: [baseSteps[baseSteps.length - 1].id],
    retrievalKeywords: extractPromptKeywords(`${prompt} fillet chamfer finish`, 6),
    validationFocus: ["stable edge query", "radius smaller than local span"],
    bodyPolicy: "separate",
  };

  return {
    shapeClass: complex ? "assembly" : dims.shape.toLowerCase(),
    assemblyComponents: complex
      ? uniqueStrings(
          extractPromptKeywords(`${prompt} bearing block fork mount plate wheel shaft pulley belt module cab drivetrain`, 12)
        )
      : [dims.shape.toLowerCase()],
    baseSkeleton: complex
      ? ["primary reference plane", "central axis", "mounting offsets"]
      : ["primary sketch plane"],
    primaryProfiles: complex
      ? ["main plate outline", "interface bores", "fork or frame profiles"]
      : ["main silhouette"],
    materialAddition: baseSteps.map(step => step.name),
    materialRemoval: complex ? ["bearing seats", "bores", "mounting holes"] : ["optional bores or pockets"],
    finishing: ["fillets", "chamfers", "patterns"],
    forbiddenSimplifications: complex
      ? ["single wheel fallback", "single cylinder fallback", "single box fallback", "template fallback"]
      : ["hidden hardcoded dimensions"],
    steps: [...baseSteps, finishingStep],
  };
}

async function buildFourPassDecomposition(prompt, dims, learningContext, requestId) {
  const fallbackPlan = planFallbackForPrompt(prompt, dims);
  try {
    const raw = await chat([
      { role: "system", content: withLearningContext(FOUR_PASS_DECOMPOSITION_SYSTEM, learningContext) },
      {
        role: "user",
        content: [
          `USER REQUEST: ${prompt}`,
          `DIMENSIONS: ${summarizeDimsForPrompt(dims)}`,
          `COMPLEX_ASSEMBLY: ${isComplexAssemblyPrompt(prompt)}`,
          `Return compact JSON only.`,
        ].join("\n"),
      },
    ], promptNeedsHighFidelityModel(prompt) ? COMPLEX_MODEL : FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
      stage: "planning",
      affinity: `${requestId}:decomposition`,
      keySlot: "k2",
      maxCompletionTokens: 1400,
    });

    const parsed = tryParseJson(raw, fallbackPlan) || fallbackPlan;
    return {
      ...parsed,
      plannerStatus: parsed === fallbackPlan ? "fallback" : "completed",
    };
  } catch (err) {
    return {
      ...fallbackPlan,
      plannerStatus: "fallback",
      plannerError: normalizeText(err?.message || String(err)).slice(0, 280),
    };
  }
}

function normalizeRetrievedRows(rows = [], kind = "knowledge") {
  return rows.map(row => traceableRow(row, kind));
}

async function buildDatabaseRetrievalPass(prompt, dims, learningContext, decomposition, requestId) {
  const promptKeywords = extractPromptKeywords(`${prompt} ${dims.shape}`, 14);
  const stepKeywords = uniqueStrings((decomposition.steps || []).flatMap(step => step.retrievalKeywords || []));
  const requestedOperations = uniqueStrings((decomposition.steps || []).map(step => step.operation).filter(Boolean));
  const knowledgeRows = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const dbRows = selectTraceableRows(
    knowledgeRows.filter(row => !String(row.source_table || "").includes("source_docs") && !String(row.memory_type || "").includes("dataset")),
    promptKeywords,
    stepKeywords,
    6,
    "db"
  );
  const datasetRows = selectTraceableRows(
    [
      ...loadDatasetSummaryRows(),
      ...knowledgeRows.filter(row => String(row.memory_type || "").includes("dataset")),
    ],
    promptKeywords,
    stepKeywords,
    6,
    "dataset"
  );
  const sourceRows = selectTraceableRows(
    [
      ...loadSourceKnowledgeRows(),
      ...knowledgeRows.filter(row => String(row.source_table || "").includes("source_docs")),
      ...(Array.isArray(learningContext.featureScriptDocs)
        ? learningContext.featureScriptDocs.map(doc => ({
            title: doc.title,
            summary: doc.text,
            keywords: extractPromptKeywords(`${doc.title || ""} ${doc.text || ""}`, 10),
            source_table: "featurescript_docs",
            source_url: doc.source || null,
            source_type: "local_doc",
          }))
        : []),
    ],
    promptKeywords,
    stepKeywords,
    6,
    "source"
  );

  const retrievalContext = JSON.stringify({
    prompt,
    dims: {
      shape: dims.shape,
      confidence: dims.confidence,
      widthInches: dims.widthInches,
      heightInches: dims.heightInches,
      depthInches: dims.depthInches,
      radiusInches: dims.radiusInches,
      holeRadiusInches: dims.holeRadiusInches,
    },
    steps: (decomposition.steps || []).map(step => ({
      id: step.id,
      operation: step.operation,
      goal: step.goal,
      retrievalKeywords: step.retrievalKeywords || [],
      validationFocus: step.validationFocus || [],
    })),
    dbRows: compactPromptRows(dbRows, 5),
    sourceRows: compactPromptRows(sourceRows, 5),
    datasetRows: compactPromptRows(datasetRows, 5),
  });

  const retrievalSettled = await Promise.allSettled([
    chat([
      { role: "system", content: "You are MODEL KEY [DATABASE_RETRIEVER] for DB and source rows. Return plain text only." },
      {
        role: "user",
        content: `Summarize the highest-value cad_knowledge, cad_memory, cad_pruning_table, and FeatureScript/FRC source rows for this prompt in 5 sentences max.\n${retrievalContext}`,
      },
    ], FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
      stage: "retrieval",
      affinity: `${requestId}:retrieval:db`,
      keySlot: "k3",
      maxCompletionTokens: 700,
    }),
    chat([
      { role: "system", content: "You are MODEL KEY [DATABASE_RETRIEVER] for dataset rows. Return plain text only." },
      {
        role: "user",
        content: `Summarize only the prompt-relevant DeepCAD and Omni-CAD dataset rows in 5 sentences max. Focus on operation patterns, component terms, and safe defaults.\n${retrievalContext}`,
      },
    ], FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
      stage: "retrieval",
      affinity: `${requestId}:retrieval:dataset`,
      keySlot: "k4",
      maxCompletionTokens: 700,
    }),
  ]);
  const dbSourceSummaryRaw = retrievalSettled[0]?.status === "fulfilled"
    ? retrievalSettled[0].value
    : `Local retrieval fallback: ${summarizeTraceableRows([...dbRows.slice(0, 3), ...sourceRows.slice(0, 3)])}`;
  const datasetSummaryRaw = retrievalSettled[1]?.status === "fulfilled"
    ? retrievalSettled[1].value
    : `Local dataset fallback: ${summarizeTraceableRows(datasetRows.slice(0, 5))}`;

  const stepMatches = (decomposition.steps || []).map(step => ({
    stepId: step.id,
    dbRows: selectTraceableRows(dbRows, promptKeywords, step.retrievalKeywords || [], 4, "db"),
    datasetRows: selectTraceableRows(datasetRows, promptKeywords, step.retrievalKeywords || [], 3, "dataset"),
    sourceRows: selectTraceableRows(sourceRows, promptKeywords, step.retrievalKeywords || [], 4, "source"),
  }));
  const operationRows = selectOperationRows([
    ...dbRows,
    ...datasetRows,
    ...sourceRows,
  ], requestedOperations, 8);

  return {
    sourcePrecedence: [
      "user prompt dimensions and constraints",
      "cad_knowledge / cad_memory / cad_pruning_table",
      "source-derived FRC and FeatureScript rules",
      "prompt-relevant DeepCAD and Omni-CAD summaries",
      "non-critical defaults only when traced",
    ],
    dbRows,
    datasetRows,
    sourceRows,
    operationRows,
    stepMatches,
    summaries: {
      dbAndSource: normalizeText(dbSourceSummaryRaw),
      dataset: normalizeText(datasetSummaryRaw),
      status: retrievalSettled.every(result => result.status === "fulfilled") ? "completed" : "local_fallback",
    },
  };
}

function classifyOperationFamily(prompt, dims, decomposition = null) {
  const text = String(prompt || "").toLowerCase();
  const requestedOps = uniqueStrings((decomposition?.steps || []).map(step => step.operation));
  if (/\bletter\b|\bimprint|engrave|emboss/.test(text)) return "imprinted_box";
  if (/\bopen[\s-]?top\b|\benclosure\b|\bhousing\b/.test(text) || requestedOps.includes("shell")) return "open_top_shell_box";
  if (/\bfillet(?:ed)?\b/.test(text) && /\bchamfer(?:ed)?\b/.test(text)) return "fillet_chamfer_block";
  if (/\bfillet(?:ed)?\b/.test(text) && (/\bbox|cube|block|rectangular/.test(text) || dims.shape === "BOX")) return "filleted_box";
  if (/\bgear\b|\bspur\b|\bpinion\b/.test(text)) return "spur_gear";
  if (/\bcarrot\b/.test(text)) return "carrot";
  if (/\bmushroom\b/.test(text)) return "mushroom";
  if (/\bswerve\b/.test(text)) return "swerve_module";
  if (/\btrain\b.*\bcab\b|\bcab\b/.test(text)) return "train_cab";
  if (/\b2\s*x\s*1\b|\b2x1\b|\bfrc\s+tube\b|\btube\b.*\bbearing\b|\btube\b.*\bmount/i.test(prompt)) return "frc_tube";
  if (/\bbelt\b|\bpulley\b/.test(text)) return "belt_side_plate";
  if (dims.shape === "BOX" || /\bbox|cube|block|rectangular/.test(text)) return "simple_box";
  return "custom";
}

function operationKindsForFamily(family) {
  const map = {
    imprinted_box: ["sketch_profile", "extrude_add", "sketch_profile", "extrude_remove", "boolean"],
    open_top_shell_box: ["sketch_profile", "extrude_add", "shell"],
    filleted_box: ["sketch_profile", "extrude_add", "fillet"],
    fillet_chamfer_block: ["sketch_profile", "extrude_add", "fillet", "chamfer"],
    carrot: ["sketch_profile", "revolve_add"],
    mushroom: ["sketch_profile", "extrude_add", "sketch_profile", "revolve_add", "boolean"],
    spur_gear: ["sketch_profile", "extrude_add", "pattern"],
    swerve_module: ["sketch_profile", "extrude_add", "sketch_profile", "extrude_add", "boolean"],
    frc_tube: ["sketch_profile", "extrude_add", "sketch_profile", "extrude_add"],
    belt_side_plate: ["sketch_profile", "extrude_add", "sketch_profile", "extrude_add"],
    train_cab: ["sketch_profile", "extrude_add", "sketch_profile", "extrude_remove", "boolean"],
    simple_box: ["sketch_profile", "extrude_add"],
  };
  return map[family] || ["sketch_profile", "extrude_add"];
}

function plannedComponentsForFamily(family, prompt = "") {
  const map = {
    imprinted_box: ["base body", "letter cut"],
    open_top_shell_box: ["outer shell", "open top cavity"],
    filleted_box: ["base block", "edge finishing"],
    fillet_chamfer_block: ["base block", "fillet", "chamfer"],
    carrot: ["revolved body"],
    mushroom: ["stem", "cap"],
    spur_gear: ["tooth profile", "bore"],
    swerve_module: ["base plate", "bearing ring", "fork", "wheel"],
    frc_tube: ["tube profile", "bearing pattern plate"],
    belt_side_plate: ["side plate", "boss pads", "center rib"],
    train_cab: ["cab shell", "window cuts"],
    simple_box: ["base block"],
  };
  return map[family] || uniqueStrings(extractPromptKeywords(prompt, 6));
}

function requestedFinishingForPrompt(prompt = "", decomposition = null) {
  const requested = [];
  if (/\bfillet|rounded\b/i.test(prompt) || (decomposition?.steps || []).some(step => step.operation === "fillet")) requested.push("fillet");
  if (/\bchamfer|bevel\b/i.test(prompt) || (decomposition?.steps || []).some(step => step.operation === "chamfer")) requested.push("chamfer");
  if (/\bshell|open[\s-]?top|hollow|wall thickness|enclosure\b/i.test(prompt) || (decomposition?.steps || []).some(step => step.operation === "shell")) requested.push("shell");
  return uniqueStrings(requested);
}

function buildDeterministicOperationPlan(prompt, dims, decomposition = null, retrieval = null) {
  const family = classifyOperationFamily(prompt, dims, decomposition);
  const featureNameMap = {
    imprinted_box: "imprintedLetterBox",
    open_top_shell_box: "openTopShellEnclosure",
    filleted_box: "filletedBlock",
    fillet_chamfer_block: "filletChamferBlock",
    carrot: "realisticCarrot",
    mushroom: "mushroomModel",
    spur_gear: "spurGear",
    swerve_module: "swerveModule",
    frc_tube: "frcTubeBearingPattern",
    belt_side_plate: "beltDrivenSidePlate",
    train_cab: "trainCab",
    simple_box: dims.featureName || "parametricBox",
    custom: dims.featureName || "customFeature",
  };
  const labelMap = {
    imprinted_box: "Imprinted Letter Box",
    open_top_shell_box: "Open Top Shell Enclosure",
    filleted_box: "Filleted Block",
    fillet_chamfer_block: "Fillet And Chamfer Block",
    carrot: "Realistic Carrot",
    mushroom: "Mushroom Model",
    spur_gear: "Spur Gear",
    swerve_module: "Swerve Module",
    frc_tube: "FRC Tube Bearing Pattern",
    belt_side_plate: "Belt Driven Side Plate",
    train_cab: "Train Cab",
    simple_box: dims.featureLabel || "Parametric Box",
    custom: dims.featureLabel || "Custom Feature",
  };
  const coveredSteps = (decomposition?.steps || []).map(step => step.id);
  return {
    family,
    featureName: featureNameMap[family] || dims.featureName || "customFeature",
    featureLabel: labelMap[family] || dims.featureLabel || "Custom Feature",
    plannedComponents: plannedComponentsForFamily(family, prompt),
    operationKinds: operationKindsForFamily(family),
    coveredSteps,
    finishingRequests: requestedFinishingForPrompt(prompt, decomposition),
    warnings: [],
    omissions: [],
    compilerOptions: {
      variant: family,
      prompt,
      sourceSummary: normalizeText(retrieval?.summaries?.dbAndSource || ""),
    },
  };
}

function compileOperationPlanToFeatureScript(operationPlan, prompt, dims, retrieval = null, weaveReview = null) {
  if (!operationPlan) return null;
  const family = operationPlan.family || "custom";
  let result = null;
  if (family === "imprinted_box") result = buildLocalImprintedBox(prompt, dims);
  else if (family === "open_top_shell_box") result = buildLocalOpenTopShellEnclosure(prompt, dims);
  else if (family === "filleted_box") result = buildLocalFilletedBox(prompt, dims);
  else if (family === "fillet_chamfer_block") result = buildLocalFilletChamferBlock(prompt, dims);
  else if (family === "carrot") result = buildLocalCarrot(prompt, dims);
  else if (family === "mushroom") result = buildLocalMushroom(prompt, dims);
  else if (family === "spur_gear") result = buildLocalSpurGear(prompt, dims);
  else if (family === "swerve_module") result = buildLocalSwerveModule(prompt, dims);
  else if (family === "frc_tube") result = buildLocalFrcTube(prompt, dims);
  else if (family === "belt_side_plate") result = buildLocalBeltSidePlate(prompt, dims);
  else if (family === "train_cab") result = buildLocalTrainCab(prompt, dims);
  else if (family === "simple_box") result = buildLocalSimpleBox(prompt, dims);
  else return null;

  if (!result) return null;
  return {
    ...result,
    operationPlan,
    warnings: uniqueStrings([
      ...(result.warnings || []),
      ...(operationPlan.warnings || []),
      ...(weaveReview?.warnings || []),
    ]),
    omissions: uniqueStrings([
      ...(result.omissions || []),
      ...(operationPlan.omissions || []),
      ...(weaveReview?.omissions || []),
    ]),
    retrieval,
  };
}

function buildBlockSynthesisPrompt({ prompt, dims, decomposition, retrieval, candidateId }) {
  return [
    `USER REQUEST: ${prompt}`,
    `CANDIDATE: ${candidateId}`,
    `DIMENSIONS: ${summarizeDimsForPrompt(dims)}`,
    `DECOMPOSITION: ${JSON.stringify({
      shapeClass: decomposition.shapeClass,
      assemblyComponents: decomposition.assemblyComponents,
      forbiddenSimplifications: decomposition.forbiddenSimplifications,
      steps: (decomposition.steps || []).map(step => ({
        id: step.id,
        name: step.name,
        operation: step.operation,
        goal: step.goal,
        dependsOn: step.dependsOn || [],
        validationFocus: step.validationFocus || [],
      })),
    })}`,
    `SOURCE_PRECEDENCE: ${retrieval.sourcePrecedence.join(" -> ")}`,
    `DB_ROWS: ${JSON.stringify(compactPromptRows(retrieval.dbRows, 4))}`,
    `SOURCE_ROWS: ${JSON.stringify(compactPromptRows(retrieval.sourceRows, 4))}`,
    `DATASET_ROWS: ${JSON.stringify(compactPromptRows(retrieval.datasetRows, 4))}`,
    `OPERATION_ROWS: ${JSON.stringify(compactPromptRows(retrieval.operationRows || [], 4))}`,
    `STEP_MATCHES: ${JSON.stringify(compactStepMatches(retrieval.stepMatches))}`,
    `Return a compact operation-plan JSON only. Do not output FeatureScript source code.`,
  ].join("\n\n");
}

function parseBlockCandidate(raw, candidateId, decomposition, prompt, dims, retrieval) {
  const fallback = {
    candidateId,
    coverageNotes: ["Block synthesis returned invalid JSON; using deterministic operation plan."],
    missingRequirements: ["Could not parse operation plan output."],
    blocks: [],
    operationPlan: buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval),
  };
  const parsed = tryParseJson(raw, fallback) || fallback;
  const steps = Array.isArray(decomposition.steps) ? decomposition.steps : [];
  const covered = new Set([
    ...(Array.isArray(parsed.blocks) ? parsed.blocks : []).map(block => block.stepId),
    ...((parsed.operationPlan?.coveredSteps) || []),
  ]);
  return {
    ...parsed,
    candidateId,
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    operationPlan: parsed.operationPlan || buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval),
    coverage: {
      coveredSteps: [...covered],
      totalSteps: steps.length,
      ratio: steps.length ? covered.size / steps.length : 0,
    },
  };
}

function scoreBlockCandidate(candidate) {
  return (candidate.coverage?.ratio || 0) * 100
    - ((candidate.missingRequirements || []).length * 10)
    + ((candidate.blocks || []).length * 2)
    + ((candidate.operationPlan?.operationKinds || []).length * 3);
}

function selectBestBlockCandidate(candidates = []) {
  return [...candidates].sort((left, right) => scoreBlockCandidate(right) - scoreBlockCandidate(left))[0] || null;
}

function fallbackBlockCandidateFromDecomposition(prompt, dims, decomposition, retrieval) {
  const steps = Array.isArray(decomposition.steps) ? decomposition.steps : [];
  const operationPlan = buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval);
  return {
    candidateId: "fallback_from_decomposition",
    coverageNotes: ["Synthesized deterministic operation plan from decomposition because model block output was missing or invalid."],
    missingRequirements: [],
    operationPlan,
    blocks: steps.map(step => ({
      stepId: step.id,
      name: step.name,
      operation: step.operation,
      dependsOn: step.dependsOn || [],
      bodyPolicy: step.bodyPolicy || "separate",
      parametersUsed: [],
      createdQueries: [],
      consumedQueries: [],
      validationChecks: step.validationFocus || [],
      fsBlock: `// Fallback block scaffold for ${step.name}\n// Operation: ${step.operation}\n// Goal: ${step.goal}`,
    })),
    coverage: {
      coveredSteps: steps.map(step => step.id),
      totalSteps: steps.length,
      ratio: steps.length ? 1 : 0,
    },
  };
}

function findAssemblyBlockers(prompt, decomposition, blockCandidate, code = "") {
  const blockers = [];
  if (isComplexAssemblyPrompt(prompt)) {
    const stepCount = Array.isArray(decomposition.steps) ? decomposition.steps.length : 0;
    const coveredCount = blockCandidate?.coverage?.coveredSteps?.length || 0;
    if (stepCount >= 3 && coveredCount < Math.max(2, stepCount - 1)) {
      blockers.push("Complex assembly coverage is incomplete across the planned steps.");
    }
    if ((decomposition.assemblyComponents || []).length > 2 && (blockCandidate?.blocks || []).length < 2) {
      blockers.push("Complex assembly collapsed into too few isolated geometry blocks.");
    }
    const downstreamOps = (String(code || "").match(/\bop(Extrude|Revolve|Loft|Sweep|Boolean|Fillet|Chamfer|Pattern)\s*\(/g) || []).length;
    if (code && downstreamOps < 2) {
      blockers.push("Complex assembly collapsed into too few downstream FeatureScript operations.");
    }
  }
  return blockers;
}

async function runBlockSynthesisPass(prompt, dims, learningContext, decomposition, retrieval, requestId) {
  const candidateSlots = [
    { id: "c1", slot: "k5" },
    { id: "c2", slot: "k6" },
    { id: "c3", slot: "k7" },
  ];
  const settled = await Promise.all(candidateSlots.map(candidate => chat([
    { role: "system", content: withLearningContext(FOUR_PASS_BLOCK_SYNTH_SYSTEM, learningContext) },
    { role: "user", content: buildBlockSynthesisPrompt({ prompt, dims, decomposition, retrieval, candidateId: candidate.id }) },
  ], promptNeedsHighFidelityModel(prompt) ? COMPLEX_MODEL : FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
    stage: "generation",
    affinity: `${requestId}:blocks:${candidate.id}`,
    keySlot: candidate.slot,
    maxCompletionTokens: 1600,
  }).then(raw => parseBlockCandidate(raw, candidate.id, decomposition, prompt, dims, retrieval)).catch(err => ({
    candidateId: candidate.id,
    coverageNotes: [`Block synthesis failed: ${err.message}`],
    missingRequirements: [err.message],
    blocks: [],
    operationPlan: buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval),
    coverage: { coveredSteps: [], totalSteps: (decomposition.steps || []).length, ratio: 0 },
  }))));

  let selected = selectBestBlockCandidate(settled);
  if (!selected || (!selected.operationPlan && !(selected.blocks || []).length)) {
    selected = fallbackBlockCandidateFromDecomposition(prompt, dims, decomposition, retrieval);
  }
  return {
    candidates: settled,
    selectedCandidateId: selected?.candidateId || null,
    selectedCandidate: selected || null,
  };
}

async function runTopologyWeaverPass(prompt, dims, learningContext, decomposition, retrieval, blockPass, requestId) {
  const selectedCandidate = blockPass.selectedCandidate;
  if (!selectedCandidate) {
    return { status: "blocked", blockers: ["No block synthesis candidate succeeded."], code: "" };
  }
  const selectedOperationPlan = selectedCandidate.operationPlan || buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval);

  let raw = "";
  try {
    raw = await chat([
    { role: "system", content: withLearningContext(FOUR_PASS_WEAVER_SYSTEM, learningContext) },
    {
      role: "user",
      content: [
        `USER REQUEST: ${prompt}`,
        `DIMENSIONS: ${summarizeDimsForPrompt(dims)}`,
        `DECOMPOSITION: ${JSON.stringify({
          shapeClass: decomposition.shapeClass,
          assemblyComponents: decomposition.assemblyComponents,
          forbiddenSimplifications: decomposition.forbiddenSimplifications,
          steps: (decomposition.steps || []).map(step => ({
            id: step.id,
            name: step.name,
            operation: step.operation,
            dependsOn: step.dependsOn || [],
            bodyPolicy: step.bodyPolicy || "separate",
          })),
        })}`,
        `RETRIEVAL_SUMMARY: ${JSON.stringify({
          sourcePrecedence: retrieval.sourcePrecedence,
          dbRows: compactPromptRows(retrieval.dbRows, 4),
          sourceRows: compactPromptRows(retrieval.sourceRows, 4),
          datasetRows: compactPromptRows(retrieval.datasetRows, 4),
          operationRows: compactPromptRows(retrieval.operationRows || [], 4),
          stepMatches: compactStepMatches(retrieval.stepMatches),
          summaries: retrieval.summaries,
        })}`,
        `SELECTED_OPERATION_PLAN: ${JSON.stringify(compactBlockCandidateForPrompt({
          ...selectedCandidate,
          operationPlan: selectedOperationPlan,
        }))}`,
        `Return JSON only.`,
      ].join("\n\n"),
    },
  ], COMPLEX_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
    stage: "generation",
    affinity: `${requestId}:weave`,
    keySlot: "k8",
    maxCompletionTokens: Math.min(GROQ_MAX_COMPLETION_TOKENS, 7200),
  });
  } catch (err) {
    return {
      status: "blocked",
      featureName: dims.featureName,
      featureLabel: dims.featureLabel,
      reasoning: "Topology review model call failed; deterministic compiler may still complete the result.",
      blockers: [`Topology weaving failed: ${normalizeText(err?.message || String(err)).slice(0, 280)}`],
      warnings: [],
      omissions: [],
      operationPlan: selectedOperationPlan,
      code: "",
    };
  }

  const parsed = tryParseJson(raw, {
    status: "completed",
    reasoning: "Topology review defaulted to deterministic compilation.",
    blockers: [],
    warnings: [],
    omissions: [],
    finishingPlan: {
      applyShell: requestedFinishingForPrompt(prompt, decomposition).includes("shell"),
      applyFillet: requestedFinishingForPrompt(prompt, decomposition).includes("fillet"),
      applyChamfer: requestedFinishingForPrompt(prompt, decomposition).includes("chamfer"),
      reason: "Deterministic compiler will enforce finishing safety locally.",
    },
  });
  const compiled = compileOperationPlanToFeatureScript(selectedOperationPlan, prompt, dims, retrieval, parsed);
  if (compiled?.code) {
    return {
      status: parsed.status === "blocked" ? "partial" : (compiled.omissions?.length ? "partial" : "completed"),
      featureName: compiled.featureName || dims.featureName,
      featureLabel: compiled.featureLabel || dims.featureLabel,
      reasoning: parsed.reasoning || compiled.strategy || "Deterministic operation compiler assembled the final FeatureScript.",
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
      warnings: uniqueStrings([...(parsed.warnings || []), ...(compiled.warnings || [])]),
      omissions: uniqueStrings([...(parsed.omissions || []), ...(compiled.omissions || [])]),
      finishingPlan: parsed.finishingPlan || null,
      operationPlan: selectedOperationPlan,
      code: sanitizeFeatureScript(compiled.code).code,
    };
  }

  return {
    status: "blocked",
    featureName: dims.featureName,
    featureLabel: dims.featureLabel,
    reasoning: parsed.reasoning || "Deterministic operation compiler could not assemble this operation plan.",
    blockers: uniqueStrings([...(parsed.blockers || []), "Operation compiler did not produce compile-safe code."]),
    warnings: parsed.warnings || [],
    omissions: parsed.omissions || [],
    finishingPlan: parsed.finishingPlan || null,
    operationPlan: selectedOperationPlan,
    code: "",
  };
}

async function runValidationRepairPass(prompt, dims, learningContext, decomposition, blockPass, weavePass, requestId) {
  const candidate = blockPass.selectedCandidate;
  const preBlockers = [
    ...(Array.isArray(weavePass.blockers) ? weavePass.blockers : []),
    ...findAssemblyBlockers(prompt, decomposition, candidate, weavePass.code || ""),
  ];

  // Sanitize the code BEFORE the validator AI call so the validator sees already-cleaned code.
  // This prevents it from blocking on auto-fixable issues (missing skSolve, IntegerBoundSpec, etc.)
  let workingCode = sanitizeFeatureScript(String(weavePass.code || "")).code;

  let validatorRaw = "";
  try {
    validatorRaw = await chat([
      { role: "system", content: FOUR_PASS_VALIDATOR_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          prompt,
          dims: {
            shape: dims.shape,
            featureName: dims.featureName,
            featureLabel: dims.featureLabel,
            widthInches: dims.widthInches,
            heightInches: dims.heightInches,
            depthInches: dims.depthInches,
            radiusInches: dims.radiusInches,
          },
          decomposition: {
            shapeClass: decomposition.shapeClass,
            assemblyComponents: decomposition.assemblyComponents,
            forbiddenSimplifications: decomposition.forbiddenSimplifications,
            steps: (decomposition.steps || []).map(step => ({
              id: step.id,
              operation: step.operation,
              goal: step.goal,
            })),
          },
          selectedBlockCandidate: compactBlockCandidateForPrompt(candidate),
          weavePass: {
            status: weavePass.status,
            featureName: weavePass.featureName,
            featureLabel: weavePass.featureLabel,
            reasoning: weavePass.reasoning,
            blockers: weavePass.blockers,
            codePreview: workingCode.slice(0, 4000),
          },
          localValidationPreview: {
            issues: validateFeatureScript(workingCode),
            fatalIssues: hasFatalFeatureScriptPatterns(workingCode),
          },
        }),
      },
    ], FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
      stage: "validation",
      affinity: `${requestId}:validation`,
      keySlot: "k9",
      maxCompletionTokens: 900,
    });
  } catch (err) {
    validatorRaw = JSON.stringify({
      status: "repair",
      blockers: [`Validator model failed: ${normalizeText(err?.message || String(err)).slice(0, 280)}`],
      notes: ["Local validation and robust FeatureScript fallback will decide final output."],
    });
  }

  const validatorPass = tryParseJson(validatorRaw, { status: "repair", blockers: [], notes: [] }) || { status: "repair", blockers: [], notes: [] };
  // workingCode already sanitized above before the validator call
  let localIssues = validateFeatureScript(workingCode);
  let fatalIssues = hasFatalFeatureScriptPatterns(workingCode);
  let repaired = false;

  if (workingCode && (localIssues.length || fatalIssues.length)) {
    try {
      const repair = await debugFeatureScript(workingCode, JSON.stringify({ localIssues, fatalIssues }), {
        learningContext,
        stage: "repair",
        affinity: `${requestId}:repair`,
        keySlot: "k9",
      });
      workingCode = sanitizeFeatureScript(repair.fixed || workingCode).code;
      repaired = true;
      localIssues = validateFeatureScript(workingCode);
      fatalIssues = hasFatalFeatureScriptPatterns(workingCode);
    } catch (err) {
      // Repair model failed — do NOT add this as a fatal issue that blocks the result.
      // The code may still be usable after sanitization. Only log it.
      console.warn(`[AI] Repair model failed during validation pass: ${err.message}`);
    }
  }

  // Only truly fatal issues should block the result.
  // Non-fatal localIssues are warnings — the code may still compile and produce geometry.
  // Fatal issues are structural problems that guarantee compilation failure.
  const fatalBlockers = uniqueStrings([
    ...preBlockers,
    ...(validatorPass.status === "blocked" ? (validatorPass.blockers || []) : []),
    ...fatalIssues.map(issue => issue.message),
  ]);

  // Non-fatal issues become warnings, not blockers
  const warnings = uniqueStrings(localIssues.map(issue => issue.message));
  const weaveWarnings = Array.isArray(weavePass.warnings) ? weavePass.warnings : [];
  const omissions = uniqueStrings(Array.isArray(weavePass.omissions) ? weavePass.omissions : []);

  return {
    validatorPass,
    repaired,
    finalCode: fatalBlockers.length ? "" : workingCode,
    blockers: fatalBlockers,
    warnings: uniqueStrings([...weaveWarnings, ...warnings]),
    omissions,
    localIssues,
    fatalIssues,
  };
}


// ─── Deterministic operation compiler ────────────────────────────────────────
//
// This is not a generic fallback template path. It is a deterministic
// FeatureScript compiler used after the four-pass chain when the model layer
// rate-limits or emits invalid JSON/code. Complex prompts still need multi-body
// coverage and traceable retrieval; otherwise we return a blocked trace.

function safeFeatureExportName(name = "customFeature") {
  const cleaned = String(name || "customFeature").replace(/[^a-zA-Z0-9_]/g, "") || "customFeature";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `ai${cleaned}`;
}

function fsLabel(label = "Custom Feature") {
  return String(label || "Custom Feature").replace(/"/g, "'");
}

function buildLocalFeatureScriptFile({ featureName, featureLabel, precondition, body }) {
  const code = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${fsLabel(featureLabel)}" }
export const ${safeFeatureExportName(featureName)} = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
${precondition}
    }
    {
${body}
    });
`;
  return sanitizeFeatureScript(code).code;
}

function fsRect(sketchVar, entityId, x1, y1, x2, y2, indent = "        ") {
  return `${indent}skRectangle(${sketchVar}, "${entityId}", {
${indent}    "firstCorner"  : ${fsPoint(x1, y1)},
${indent}    "secondCorner" : ${fsPoint(x2, y2)}
${indent}});`;
}

function fsCircle(sketchVar, entityId, x, y, radius, indent = "        ") {
  return `${indent}skCircle(${sketchVar}, "${entityId}", { "center" : ${fsPoint(x, y)}, "radius" : ${radius} });`;
}

function fsLine(sketchVar, entityId, x1, y1, x2, y2, indent = "        ") {
  return `${indent}skLineSegment(${sketchVar}, "${entityId}", {
${indent}    "start" : ${fsPoint(x1, y1)},
${indent}    "end"   : ${fsPoint(x2, y2)}
${indent}});`;
}

function sourcePrecedenceList() {
  return [
    "user prompt dimensions and constraints",
    "cad_knowledge / cad_memory / cad_pruning_table",
    "source-derived FRC and FeatureScript rules",
    "prompt-relevant DeepCAD and Omni-CAD summaries",
    "non-critical defaults only when traced",
  ];
}

function buildLocalRetrievalFallback(prompt, dims, learningContext = {}, decomposition = null) {
  const plan = decomposition || planFallbackForPrompt(prompt, dims);
  const promptKeywords = extractPromptKeywords(`${prompt} ${dims.shape}`, 14);
  const stepKeywords = uniqueStrings((plan.steps || []).flatMap(step => step.retrievalKeywords || []));
  const knowledgeRows = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const dbRows = selectTraceableRows(
    knowledgeRows.filter(row => !String(row.source_table || "").includes("source_docs") && !String(row.memory_type || "").includes("dataset")),
    promptKeywords,
    stepKeywords,
    6,
    "db"
  );
  const datasetRows = selectTraceableRows(
    [
      ...loadDatasetSummaryRows(),
      ...knowledgeRows.filter(row => String(row.memory_type || "").includes("dataset")),
    ],
    promptKeywords,
    stepKeywords,
    6,
    "dataset"
  );
  const sourceRows = selectTraceableRows(
    [
      ...loadSourceKnowledgeRows(),
      ...knowledgeRows.filter(row => String(row.source_table || "").includes("source_docs")),
    ],
    promptKeywords,
    stepKeywords,
    6,
    "source"
  );
  const stepMatches = (plan.steps || []).map(step => ({
    stepId: step.id,
    dbRows: selectTraceableRows(dbRows, promptKeywords, step.retrievalKeywords || [], 4, "db"),
    datasetRows: selectTraceableRows(datasetRows, promptKeywords, step.retrievalKeywords || [], 3, "dataset"),
    sourceRows: selectTraceableRows(sourceRows, promptKeywords, step.retrievalKeywords || [], 4, "source"),
  }));
  const operationRows = selectOperationRows([
    ...dbRows,
    ...datasetRows,
    ...sourceRows,
  ], uniqueStrings((plan.steps || []).map(step => step.operation).filter(Boolean)), 8);
  return {
    sourcePrecedence: sourcePrecedenceList(),
    dbRows,
    datasetRows,
    sourceRows,
    operationRows,
    stepMatches,
    summaries: {
      status: "local_fallback",
      dbAndSource: normalizeText(summarizeTraceableRows([...dbRows.slice(0, 3), ...sourceRows.slice(0, 3)])),
      dataset: normalizeText(summarizeTraceableRows(datasetRows.slice(0, 5))),
    },
  };
}
// Onshape tools with FeatureScript
function buildLocalFilletedBox(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Width", 0.25, dims.widthInches || 2, 96),
    preconditionLength("height", "Height", 0.25, dims.heightInches || 2, 96),
    preconditionLength("depth", "Depth", 0.25, dims.depthInches || 2, 96),
    preconditionLength("filletRadius", "Fillet Radius", 0.01, dims.filletRadiusInches || 0.12, 12),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfH = definition.height / 2;
        var safeFilletRadius = min(definition.filletRadius, min(definition.width, min(definition.height, definition.depth)) * 0.18);
        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
${fsRect("baseSketch", "blockProfile", "-halfW", "-halfH", "halfW", "halfH")}
        skSolve(baseSketch);
        opExtrude(context, id + "blockBody", {
            "entities"  : qSketchRegion(id + "baseSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });
        opFillet(context, id + "edgeFillet", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "blockBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius" : safeFilletRadius
        });`;
  return {
    featureName: "filletedBlock",
    featureLabel: "Filleted Block",
    code: buildLocalFeatureScriptFile({ featureName: "filletedBlock", featureLabel: "Filleted Block", precondition, body }),
    strategy: "Deterministic operation compiler generated a prismatic block with a clamped edge fillet applied after solid creation.",
  };
}

function buildLocalFilletChamferBlock(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Width", 0.25, dims.widthInches || 2, 96),
    preconditionLength("depth", "Depth", 0.25, dims.depthInches || 1.25, 96),
    preconditionLength("height", "Height", 0.25, dims.heightInches || 0.5, 96),
    preconditionLength("filletRadius", "Fillet Radius", 0.01, dims.filletRadiusInches || 0.08, 12),
    preconditionLength("chamferWidth", "Chamfer Width", 0.005, 0.04, 12),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfD = definition.depth / 2;
        var safeFilletRadius = min(definition.filletRadius, min(definition.width, min(definition.depth, definition.height)) * 0.14);
        var safeChamferWidth = min(definition.chamferWidth, min(definition.width, min(definition.depth, definition.height)) * 0.1);
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : skPlane });
${fsRect("profileSketch", "blockProfile", "-halfW", "-halfD", "halfW", "halfD")}
        skSolve(profileSketch);
        opExtrude(context, id + "blockBody", {
            "entities" : qSketchRegion(id + "profileSketch"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        opFillet(context, id + "edgeFillet", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "blockBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius" : safeFilletRadius
        });
        opChamfer(context, id + "edgeChamfer", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "blockBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width" : safeChamferWidth
        });`;
  return {
    featureName: "filletChamferBlock",
    featureLabel: "Fillet And Chamfer Block",
    code: buildLocalFeatureScriptFile({ featureName: "filletChamferBlock", featureLabel: "Fillet And Chamfer Block", precondition, body }),
    strategy: "Deterministic operation compiler generated a block and applied clamped fillet and chamfer operations after the base solid.",
  };
}

function buildLocalOpenTopShellEnclosure(prompt, dims) {
  const defaultWidth = dims.widthInches || 4;
  const defaultDepth = dims.depthInches || 3;
  const defaultHeight = dims.heightInches || 1.5;
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Width", 0.5, defaultWidth, 120),
    preconditionLength("depth", "Depth", 0.5, defaultDepth, 120),
    preconditionLength("height", "Height", 0.25, defaultHeight, 120),
    preconditionLength("wallThickness", "Wall Thickness", 0.01, dims.wallThicknessInches || 0.1, 12),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfD = definition.depth / 2;
        var safeWallThickness = min(definition.wallThickness, min(definition.width, min(definition.depth, definition.height)) * 0.45);
        var enclosureSketch = newSketchOnPlane(context, id + "enclosureSketch", { "sketchPlane" : skPlane });
${fsRect("enclosureSketch", "outerProfile", "-halfW", "-halfD", "halfW", "halfD")}
        skSolve(enclosureSketch);
        opExtrude(context, id + "outerBody", {
            "entities" : qSketchRegion(id + "enclosureSketch"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        opShell(context, id + "shellBody", {
            "entities" : qCapEntity(id + "outerBody", CapType.END, EntityType.FACE),
            "thickness" : -safeWallThickness
        });`;
  return {
    featureName: "openTopShellEnclosure",
    featureLabel: "Open Top Shell Enclosure",
    code: buildLocalFeatureScriptFile({ featureName: "openTopShellEnclosure", featureLabel: "Open Top Shell Enclosure", precondition, body }),
    strategy: "Deterministic operation compiler generated an extruded enclosure body and shelled it from the top cap with a clamped inward wall thickness.",
  };
}

function buildLocalCarrot(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("bottomRadius", "Base Radius", 0.1, dims.radiusInches || 0.75, 24),
    preconditionLength("topRadius", "Top Radius", 0, dims.holeRadiusInches || 0.03, 24),
    preconditionLength("height", "Height", 0.5, dims.heightInches || dims.depthInches || 6, 120),
  ].join("\n");
  const body = `${planeVar()}
        var bottomRadius = definition.bottomRadius;
        var topRadius = min(definition.topRadius, definition.bottomRadius * 0.3);
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : skPlane });
        skLineSegment(profileSketch, "axis", {
            "start" : vector(0, 0) * inch,
            "end" : vector(0, definition.height / inch) * inch
        });
        skLineSegment(profileSketch, "bottomEdge", {
            "start" : vector(0, 0) * inch,
            "end" : vector(definition.bottomRadius / inch, 0) * inch
        });
        skFitSpline(profileSketch, "outerProfile", {
            "points" : [
                vector(definition.bottomRadius / inch, 0) * inch,
                vector((definition.bottomRadius * 0.95) / inch, (definition.height * 0.18) / inch) * inch,
                vector((definition.bottomRadius * 0.62) / inch, (definition.height * 0.55) / inch) * inch,
                vector((max(topRadius, definition.bottomRadius * 0.04)) / inch, definition.height / inch) * inch
            ]
        });
        skLineSegment(profileSketch, "topEdge", {
            "start" : vector((max(topRadius, definition.bottomRadius * 0.04)) / inch, definition.height / inch) * inch,
            "end" : vector(0, definition.height / inch) * inch
        });
        skSolve(profileSketch);
        opRevolve(context, id + "carrotBody", {
            "entities" : qSketchRegion(id + "profileSketch"),
            "axis" : line(skPlane.origin, skPlane.normal),
            "angleForward" : 2 * PI * radian
        });`;
  return {
    featureName: "realisticCarrot",
    featureLabel: "Realistic Carrot",
    code: buildLocalFeatureScriptFile({ featureName: "realisticCarrot", featureLabel: "Realistic Carrot", precondition, body }),
    strategy: "Deterministic operation compiler generated a revolved carrot profile from a solved spline-and-line silhouette.",
  };
}

function buildLocalMushroom(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("stemRadius", "Stem Radius", 0.05, dims.radiusInches * 0.25 || 0.25, 12),
    preconditionLength("stemHeight", "Stem Height", 0.2, dims.heightInches || 1.2, 48),
    preconditionLength("capRadius", "Cap Radius", 0.1, dims.radiusInches || 0.8, 24),
    preconditionLength("capHeight", "Cap Height", 0.1, dims.depthInches || 0.45, 24),
  ].join("\n");
  const body = `${planeVar()}
        var stemSketch = newSketchOnPlane(context, id + "stemSketch", { "sketchPlane" : skPlane });
        skCircle(stemSketch, "stemProfile", { "center" : vector(0, 0) * inch, "radius" : definition.stemRadius });
        skSolve(stemSketch);
        opExtrude(context, id + "stemBody", {
            "entities" : qSketchRegion(id + "stemSketch"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.stemHeight
        });

        var capPlane = plane(skPlane.origin + skPlane.normal * definition.stemHeight, skPlane.x);
        var capSketch = newSketchOnPlane(context, id + "capSketch", { "sketchPlane" : capPlane });
        skLineSegment(capSketch, "capBase", {
            "start" : vector(0, 0) * inch,
            "end" : vector(definition.capRadius / inch, 0) * inch
        });
        skArc(capSketch, "capArc", {
            "start" : vector(definition.capRadius / inch, 0) * inch,
            "mid" : vector((definition.capRadius * 0.65) / inch, definition.capHeight / inch) * inch,
            "end" : vector(0, definition.capHeight / inch) * inch
        });
        skLineSegment(capSketch, "capAxisClose", {
            "start" : vector(0, definition.capHeight / inch) * inch,
            "end" : vector(0, 0) * inch
        });
        skSolve(capSketch);
        opRevolve(context, id + "capBody", {
            "entities" : qSketchRegion(id + "capSketch"),
            "axis" : line(skPlane.origin + skPlane.normal * definition.stemHeight, skPlane.normal),
            "angleForward" : 2 * PI * radian
        });
        opBoolean(context, id + "joinCapToStem", {
            "tools" : qCreatedBy(id + "capBody", EntityType.BODY),
            "targets" : qCreatedBy(id + "stemBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });`;
  return {
    featureName: "mushroomModel",
    featureLabel: "Mushroom Model",
    code: buildLocalFeatureScriptFile({ featureName: "mushroomModel", featureLabel: "Mushroom Model", precondition, body }),
    strategy: "Deterministic operation compiler generated a mushroom from an extruded stem and a revolved cap joined afterward.",
  };
}

function buildLocalSpurGear(prompt, dims) {
  const teeth = Math.max(8, Math.round(dims.numTeeth || 20));
  const ratioMatch = String(prompt || "").match(/(\d+)\s*:\s*(\d+)/);
  const defaultTeeth = ratioMatch ? Math.max(8, Number(ratioMatch[1]) * 10) : teeth;
  const precondition = [
    preconditionPlane(),
    preconditionInteger("numTeeth", "Number of Teeth", 6, defaultTeeth, 200),
    preconditionLength("pitchRadius", "Pitch Radius", 0.1, dims.radiusInches || 1, 24),
    preconditionLength("boreRadius", "Bore Radius", 0, dims.holeRadiusInches || 0.2, 12),
    preconditionLength("faceWidth", "Face Width", 0.05, dims.depthInches || 0.5, 24),
  ].join("\n");

  const gearDims = {
    numTeeth: defaultTeeth,
    moduleInches: 0.0787402,
    depthInches: dims.depthInches || 0.5,
    holeRadiusInches: dims.holeRadiusInches || 0.2,
  };
  const gearBody = templateSpurGearFixed(gearDims);
  const body = `${planeVar()}
        var pitchRadius = definition.pitchRadius;
        var faceWidth = definition.faceWidth;
        var boreRadius = definition.boreRadius;
${gearBody
  .replace(`${planeVar()}\n`, "")
  .replace(/definition\.radius/g, "pitchRadius")
  .replace(/definition\.faceWidth/g, "faceWidth")
  .replace(/definition\.holeRadius/g, "boreRadius")
  .replace(/definition\.numTeeth/g, "definition.numTeeth")}`;
  return {
    featureName: "spurGear",
    featureLabel: "Spur Gear",
    code: buildLocalFeatureScriptFile({ featureName: "spurGear", featureLabel: "Spur Gear", precondition, body }),
    strategy: "Deterministic operation compiler generated a closed-profile spur gear from a source-backed tooth construction and extruded it to face width.",
  };
}

function requestedLetter(prompt = "") {
  const text = String(prompt || "");
  const direct = text.match(/\bletter\s+["']?([a-z0-9])["']?/i);
  if (direct) return direct[1].toUpperCase();
  const quoted = text.match(/["']([a-z0-9])["']/i);
  if (quoted) return quoted[1].toUpperCase();
  return "A";
}

function buildLetterStrokeSketch(letter) {
  const upper = String(letter || "A").toUpperCase();
  const strokes = {
    A: [
      ["left", "-letterW / 2", "-letterH / 2", "-letterW / 2 + stroke", "letterH / 2"],
      ["right", "letterW / 2 - stroke", "-letterH / 2", "letterW / 2", "letterH / 2"],
      ["top", "-letterW / 2", "letterH / 2 - stroke", "letterW / 2", "letterH / 2"],
      ["mid", "-letterW / 2", "-stroke / 2", "letterW / 2", "stroke / 2"],
    ],
    H: [
      ["left", "-letterW / 2", "-letterH / 2", "-letterW / 2 + stroke", "letterH / 2"],
      ["right", "letterW / 2 - stroke", "-letterH / 2", "letterW / 2", "letterH / 2"],
      ["mid", "-letterW / 2", "-stroke / 2", "letterW / 2", "stroke / 2"],
    ],
    I: [
      ["top", "-letterW / 2", "letterH / 2 - stroke", "letterW / 2", "letterH / 2"],
      ["mid", "-stroke / 2", "-letterH / 2", "stroke / 2", "letterH / 2"],
      ["bottom", "-letterW / 2", "-letterH / 2", "letterW / 2", "-letterH / 2 + stroke"],
    ],
    T: [
      ["top", "-letterW / 2", "letterH / 2 - stroke", "letterW / 2", "letterH / 2"],
      ["mid", "-stroke / 2", "-letterH / 2", "stroke / 2", "letterH / 2"],
    ],
    E: [
      ["left", "-letterW / 2", "-letterH / 2", "-letterW / 2 + stroke", "letterH / 2"],
      ["top", "-letterW / 2", "letterH / 2 - stroke", "letterW / 2", "letterH / 2"],
      ["mid", "-letterW / 2", "-stroke / 2", "letterW * 0.35", "stroke / 2"],
      ["bottom", "-letterW / 2", "-letterH / 2", "letterW / 2", "-letterH / 2 + stroke"],
    ],
    L: [
      ["left", "-letterW / 2", "-letterH / 2", "-letterW / 2 + stroke", "letterH / 2"],
      ["bottom", "-letterW / 2", "-letterH / 2", "letterW / 2", "-letterH / 2 + stroke"],
    ],
    O: [
      ["left", "-letterW / 2", "-letterH / 2", "-letterW / 2 + stroke", "letterH / 2"],
      ["right", "letterW / 2 - stroke", "-letterH / 2", "letterW / 2", "letterH / 2"],
      ["top", "-letterW / 2", "letterH / 2 - stroke", "letterW / 2", "letterH / 2"],
      ["bottom", "-letterW / 2", "-letterH / 2", "letterW / 2", "-letterH / 2 + stroke"],
    ],
  };
  const selected = strokes[upper] || strokes.A;
  return selected.map(([idSuffix, x1, y1, x2, y2]) => fsRect("letterSketch", `stroke_${idSuffix}`, x1, y1, x2, y2)).join("\n");
}

function buildLocalImprintedBox(prompt, dims) {
  const letter = requestedLetter(prompt);
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Width", 0.25, dims.widthInches || 2, 96),
    preconditionLength("height", "Height", 0.25, dims.heightInches || 2, 96),
    preconditionLength("depth", "Depth", 0.25, dims.depthInches || 1, 96),
    preconditionLength("letterStroke", "Letter Stroke Width", 0.02, 0.12, 2),
    preconditionLength("imprintDepth", "Imprint Depth", 0.01, 0.08, 2),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfH = definition.height / 2;
        var safeImprintDepth = min(definition.imprintDepth, definition.depth * 0.4);

        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
${fsRect("baseSketch", "boxProfile", "-halfW", "-halfH", "halfW", "halfH")}
        skSolve(baseSketch);
        opExtrude(context, id + "baseBody", {
            "entities"  : qSketchRegion(id + "baseSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });

        var letterPlane = plane(skPlane.origin + skPlane.normal * (definition.depth + safeImprintDepth * 0.05), skPlane.normal);
        var letterW = min(definition.width * 0.55, definition.height * 0.75);
        var letterH = min(definition.height * 0.7, definition.width * 0.8);
        var stroke = min(definition.letterStroke, letterW * 0.25);
        var letterSketch = newSketchOnPlane(context, id + "letterSketch", { "sketchPlane" : letterPlane });
${buildLetterStrokeSketch(letter)}
        skSolve(letterSketch);
        opExtrude(context, id + "letterCutBodies", {
            "entities"  : qSketchRegion(id + "letterSketch"),
            "direction" : letterPlane.normal * -1,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : safeImprintDepth * 1.1
        });
        opBoolean(context, id + "subtractLetter", {
            "tools" : qCreatedBy(id + "letterCutBodies", EntityType.BODY),
            "targets" : qCreatedBy(id + "baseBody", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });`;
  return {
    featureName: "imprintedLetterBox",
    featureLabel: `Imprinted Letter ${letter} Box`,
    code: buildLocalFeatureScriptFile({
      featureName: "imprintedLetterBox",
      featureLabel: `Imprinted Letter ${letter} Box`,
      precondition,
      body,
    }),
    strategy: `Deterministic operation compiler generated a box with a block-stroke ${letter} cut into the front face using scoped boolean tool bodies.`,
  };
}

function buildLocalTrainCab(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Cab Width", 2, dims.widthInches || 8, 96),
    preconditionLength("height", "Cab Wall Height", 2, dims.heightInches || 5, 96),
    preconditionLength("depth", "Cab Depth", 1, dims.depthInches || 4, 96),
    preconditionLength("roofHeight", "Roof Peak Height", 0.2, 1, 24),
    preconditionLength("windowWidth", "Window Width", 0.2, 1.2, 24),
    preconditionLength("windowHeight", "Window Height", 0.2, 1, 24),
    preconditionLength("windowDepth", "Window Cut Depth", 0.02, 0.1, 4),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfH = definition.height / 2;
        var roofPeak = halfH + definition.roofHeight;
        var safeWindowDepth = min(definition.windowDepth, definition.depth * 0.25);

        var shellSketch = newSketchOnPlane(context, id + "shellSketch", { "sketchPlane" : skPlane });
${fsLine("shellSketch", "bottom", "-halfW", "-halfH", "halfW", "-halfH")}
${fsLine("shellSketch", "rightWall", "halfW", "-halfH", "halfW", "halfH")}
${fsLine("shellSketch", "rightRoof", "halfW", "halfH", "0 * inch", "roofPeak")}
${fsLine("shellSketch", "leftRoof", "0 * inch", "roofPeak", "-halfW", "halfH")}
${fsLine("shellSketch", "leftWall", "-halfW", "halfH", "-halfW", "-halfH")}
        skSolve(shellSketch);
        opExtrude(context, id + "cabShell", {
            "entities"  : qSketchRegion(id + "shellSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });

        var frontPlane = plane(skPlane.origin + skPlane.normal * (definition.depth + safeWindowDepth * 0.05), skPlane.normal);
        var windowSketch = newSketchOnPlane(context, id + "frontWindowSketch", { "sketchPlane" : frontPlane });
        var wx = definition.windowWidth / 2;
        var wy = definition.windowHeight / 2;
        var windowY = definition.height * 0.12;
${fsRect("windowSketch", "leftWindow", "-definition.width * 0.28 - wx", "windowY - wy", "-definition.width * 0.28 + wx", "windowY + wy")}
${fsRect("windowSketch", "rightWindow", "definition.width * 0.28 - wx", "windowY - wy", "definition.width * 0.28 + wx", "windowY + wy")}
${fsRect("windowSketch", "doorPanel", "-definition.width * 0.12", "-definition.height * 0.48", "definition.width * 0.12", "-definition.height * 0.05")}
        skSolve(windowSketch);
        opExtrude(context, id + "frontWindowCuts", {
            "entities"  : qSketchRegion(id + "frontWindowSketch"),
            "direction" : frontPlane.normal * -1,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : safeWindowDepth * 1.1
        });
        opBoolean(context, id + "subtractFrontWindows", {
            "tools" : qCreatedBy(id + "frontWindowCuts", EntityType.BODY),
            "targets" : qCreatedBy(id + "cabShell", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });`;
  return {
    featureName: "trainCab",
    featureLabel: "Train Cab",
    code: buildLocalFeatureScriptFile({ featureName: "trainCab", featureLabel: "Train Cab", precondition, body }),
    strategy: "Deterministic operation compiler generated a peaked cab shell with scoped front window and door-panel subtraction bodies.",
  };
}

function buildLocalFrcTube(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("tubeWidth", "Tube Width", 0.5, 2, 6),
    preconditionLength("tubeHeight", "Tube Height", 0.5, 1, 6),
    preconditionLength("tubeLength", "Tube Length", 1, dims.depthInches || 12, 120),
    preconditionLength("wallThickness", "Wall Thickness", 0.03, 0.125, 1),
    preconditionLength("bearingOuterRadius", "Bearing OD Radius", 0.1, 0.5625, 2),
    preconditionLength("boltHoleRadius", "Bolt Hole Radius", 0.03, 0.1, 0.5),
    preconditionLength("boltSpacing", "Bolt Spacing", 0.5, 1.5, 6),
    preconditionLength("endPlateThickness", "End Plate Thickness", 0.03, 0.125, 1),
  ].join("\n");
  const body = `${planeVar()}
        var outerHalfW = definition.tubeWidth / 2;
        var outerHalfH = definition.tubeHeight / 2;
        var innerHalfW = max(definition.tubeWidth / 2 - definition.wallThickness, definition.tubeWidth * 0.2);
        var innerHalfH = max(definition.tubeHeight / 2 - definition.wallThickness, definition.tubeHeight * 0.2);

        var tubeSketch = newSketchOnPlane(context, id + "tubeSketch", { "sketchPlane" : skPlane });
${fsRect("tubeSketch", "outerTube", "-outerHalfW", "-outerHalfH", "outerHalfW", "outerHalfH")}
${fsRect("tubeSketch", "innerTube", "-innerHalfW", "-innerHalfH", "innerHalfW", "innerHalfH")}
        skSolve(tubeSketch);
        opExtrude(context, id + "tubeBody", {
            "entities"  : qSketchRegion(id + "tubeSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.tubeLength
        });

        var endPlane = plane(skPlane.origin + skPlane.normal * definition.tubeLength, skPlane.normal);
        var patternSketch = newSketchOnPlane(context, id + "bearingPatternSketch", { "sketchPlane" : endPlane });
${fsRect("patternSketch", "endPlate", "-outerHalfW", "-outerHalfH", "outerHalfW", "outerHalfH")}
${fsCircle("patternSketch", "bearingBore", "0 * inch", "0 * inch", "definition.bearingOuterRadius")}
${fsCircle("patternSketch", "bolt1", "-definition.boltSpacing / 2", "-definition.boltSpacing / 2", "definition.boltHoleRadius")}
${fsCircle("patternSketch", "bolt2", "definition.boltSpacing / 2", "-definition.boltSpacing / 2", "definition.boltHoleRadius")}
${fsCircle("patternSketch", "bolt3", "-definition.boltSpacing / 2", "definition.boltSpacing / 2", "definition.boltHoleRadius")}
${fsCircle("patternSketch", "bolt4", "definition.boltSpacing / 2", "definition.boltSpacing / 2", "definition.boltHoleRadius")}
        skSolve(patternSketch);
        opExtrude(context, id + "bearingEndPlate", {
            "entities"  : qSketchRegion(id + "bearingPatternSketch", true),
            "direction" : endPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.endPlateThickness
        });`;
  return {
    featureName: "frcTubeBearingPattern",
    featureLabel: "FRC Tube Bearing Pattern",
    code: buildLocalFeatureScriptFile({ featureName: "frcTubeBearingPattern", featureLabel: "FRC Tube Bearing Pattern", precondition, body }),
    strategy: "Deterministic operation compiler generated a 2x1 FRC tube with a hollow profile and separate bearing-pattern end plate using standard 1.125 in bearing OD default.",
  };
}

function buildLocalBeltSidePlate(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("plateLength", "Plate Length", 3, dims.widthInches || 8, 120),
    preconditionLength("plateHeight", "Plate Height", 1, dims.heightInches || 3, 48),
    preconditionLength("plateThickness", "Plate Thickness", 0.03, dims.depthInches || 0.25, 4),
    preconditionLength("centerDistance", "Pulley Center Distance", 1, 5, 60),
    preconditionLength("pulleyClearanceRadius", "Pulley Clearance Radius", 0.1, 0.75, 6),
    preconditionLength("boltHoleRadius", "Bolt Hole Radius", 0.03, 0.1, 0.5),
    preconditionLength("boltOffset", "Bolt Offset", 0.2, 0.45, 3),
    preconditionLength("bossHeight", "Bearing Boss Height", 0.02, 0.125, 2),
  ].join("\n");
  const body = `${planeVar()}
        var halfL = definition.plateLength / 2;
        var halfH = definition.plateHeight / 2;
        var pulleyX = definition.centerDistance / 2;

        var plateSketch = newSketchOnPlane(context, id + "beltPlateSketch", { "sketchPlane" : skPlane });
${fsRect("plateSketch", "plateProfile", "-halfL", "-halfH", "halfL", "halfH")}
${fsCircle("plateSketch", "leftPulleyClearance", "-pulleyX", "0 * inch", "definition.pulleyClearanceRadius")}
${fsCircle("plateSketch", "rightPulleyClearance", "pulleyX", "0 * inch", "definition.pulleyClearanceRadius")}
${fsCircle("plateSketch", "leftTopBolt", "-pulleyX", "definition.pulleyClearanceRadius + definition.boltOffset", "definition.boltHoleRadius")}
${fsCircle("plateSketch", "leftBottomBolt", "-pulleyX", "-definition.pulleyClearanceRadius - definition.boltOffset", "definition.boltHoleRadius")}
${fsCircle("plateSketch", "rightTopBolt", "pulleyX", "definition.pulleyClearanceRadius + definition.boltOffset", "definition.boltHoleRadius")}
${fsCircle("plateSketch", "rightBottomBolt", "pulleyX", "-definition.pulleyClearanceRadius - definition.boltOffset", "definition.boltHoleRadius")}
        skSolve(plateSketch);
        opExtrude(context, id + "beltSidePlate", {
            "entities"  : qSketchRegion(id + "beltPlateSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.plateThickness
        });

        var topPlane = plane(skPlane.origin + skPlane.normal * definition.plateThickness, skPlane.normal);
        var bossSketch = newSketchOnPlane(context, id + "bearingBossSketch", { "sketchPlane" : topPlane });
${fsCircle("bossSketch", "leftBossOuter", "-pulleyX", "0 * inch", "definition.pulleyClearanceRadius * 0.58")}
${fsCircle("bossSketch", "leftBossInner", "-pulleyX", "0 * inch", "definition.boltHoleRadius * 1.8")}
${fsCircle("bossSketch", "rightBossOuter", "pulleyX", "0 * inch", "definition.pulleyClearanceRadius * 0.58")}
${fsCircle("bossSketch", "rightBossInner", "pulleyX", "0 * inch", "definition.boltHoleRadius * 1.8")}
        skSolve(bossSketch);
        opExtrude(context, id + "bearingBossPads", {
            "entities"  : qSketchRegion(id + "bearingBossSketch", true),
            "direction" : topPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.bossHeight
        });

        var beltRibSketch = newSketchOnPlane(context, id + "beltRibSketch", { "sketchPlane" : topPlane });
${fsRect("beltRibSketch", "beltCenterRib", "-pulleyX", "-definition.boltHoleRadius", "pulleyX", "definition.boltHoleRadius")}
        skSolve(beltRibSketch);
        opExtrude(context, id + "beltCenterRib", {
            "entities"  : qSketchRegion(id + "beltRibSketch"),
            "direction" : topPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.bossHeight * 0.65
        });`;
  return {
    featureName: "beltDrivenSidePlate",
    featureLabel: "Belt Driven Side Plate",
    code: buildLocalFeatureScriptFile({ featureName: "beltDrivenSidePlate", featureLabel: "Belt Driven Side Plate", precondition, body }),
    strategy: "Deterministic operation compiler generated a belt side plate with exposed center-to-center pulley spacing and symmetric clearance/bolt patterns.",
  };
}

function buildLocalSwerveModule(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("plateWidth", "Base Plate Width", 2, dims.widthInches || 5, 48),
    preconditionLength("plateLength", "Base Plate Length", 2, dims.heightInches || 5, 48),
    preconditionLength("plateThickness", "Base Plate Thickness", 0.05, 0.25, 4),
    preconditionLength("wheelDiameter", "Wheel Diameter", 1, 4, 12),
    preconditionLength("wheelWidth", "Wheel Width", 0.25, 1.5, 6),
    preconditionLength("wheelOffset", "Wheel Offset", 0, 0.8, 12),
    preconditionLength("forkThickness", "Fork Plate Thickness", 0.05, 0.25, 2),
    preconditionLength("forkHeight", "Fork Height", 0.5, 2.75, 12),
    preconditionLength("bearingOuterRadius", "Steering Bearing OD Radius", 0.2, 1.125, 6),
    preconditionLength("shaftBoreRadius", "Wheel Shaft Bore Radius", 0.05, 0.25, 2),
    preconditionLength("boltHoleRadius", "Bolt Hole Radius", 0.03, 0.1, 0.5),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.plateWidth / 2;
        var halfL = definition.plateLength / 2;
        var wheelR = definition.wheelDiameter / 2;
        var wheelHalfW = definition.wheelWidth / 2;
        var forkOffsetX = wheelHalfW + definition.forkThickness / 2;
        var forkYMin = definition.wheelOffset - wheelR * 0.7;
        var forkYMax = definition.wheelOffset + wheelR * 0.7;

        var baseSketch = newSketchOnPlane(context, id + "basePlateSketch", { "sketchPlane" : skPlane });
${fsRect("baseSketch", "basePlate", "-halfW", "-halfL", "halfW", "halfL")}
${fsCircle("baseSketch", "steeringBore", "0 * inch", "0 * inch", "definition.bearingOuterRadius * 0.45")}
${fsCircle("baseSketch", "mountBolt1", "-halfW * 0.65", "-halfL * 0.65", "definition.boltHoleRadius")}
${fsCircle("baseSketch", "mountBolt2", "halfW * 0.65", "-halfL * 0.65", "definition.boltHoleRadius")}
${fsCircle("baseSketch", "mountBolt3", "-halfW * 0.65", "halfL * 0.65", "definition.boltHoleRadius")}
${fsCircle("baseSketch", "mountBolt4", "halfW * 0.65", "halfL * 0.65", "definition.boltHoleRadius")}
        skSolve(baseSketch);
        opExtrude(context, id + "basePlate", {
            "entities"  : qSketchRegion(id + "basePlateSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.plateThickness
        });

        var topPlane = plane(skPlane.origin + skPlane.normal * definition.plateThickness, skPlane.normal);
        var bearingSketch = newSketchOnPlane(context, id + "bearingRingSketch", { "sketchPlane" : topPlane });
${fsCircle("bearingSketch", "bearingOuter", "0 * inch", "0 * inch", "definition.bearingOuterRadius")}
${fsCircle("bearingSketch", "bearingInner", "0 * inch", "0 * inch", "definition.bearingOuterRadius * 0.58")}
        skSolve(bearingSketch);
        opExtrude(context, id + "steeringBearingRing", {
            "entities"  : qSketchRegion(id + "bearingRingSketch", true),
            "direction" : topPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.plateThickness
        });

        var forkSketch = newSketchOnPlane(context, id + "forkFootprintSketch", { "sketchPlane" : topPlane });
${fsRect("forkSketch", "leftForkPlate", "-forkOffsetX - definition.forkThickness / 2", "forkYMin", "-forkOffsetX + definition.forkThickness / 2", "forkYMax")}
${fsRect("forkSketch", "rightForkPlate", "forkOffsetX - definition.forkThickness / 2", "forkYMin", "forkOffsetX + definition.forkThickness / 2", "forkYMax")}
${fsRect("forkSketch", "driveMotorBlock", "-definition.wheelWidth", "-halfL * 0.75", "definition.wheelWidth", "-halfL * 0.25")}
        skSolve(forkSketch);
        opExtrude(context, id + "forkAndMotorBodies", {
            "entities"  : qSketchRegion(id + "forkFootprintSketch"),
            "direction" : topPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.forkHeight
        });

        var wheelPlane = plane(skPlane.origin + skPlane.normal * (definition.plateThickness + wheelR) + skPlane.y * definition.wheelOffset + skPlane.x * (-wheelHalfW), skPlane.x);
        var wheelSketch = newSketchOnPlane(context, id + "wheelSketch", { "sketchPlane" : wheelPlane });
${fsCircle("wheelSketch", "wheelOuter", "0 * inch", "0 * inch", "wheelR")}
${fsCircle("wheelSketch", "wheelBore", "0 * inch", "0 * inch", "definition.shaftBoreRadius")}
        skSolve(wheelSketch);
        opExtrude(context, id + "wheelBody", {
            "entities"  : qSketchRegion(id + "wheelSketch", true),
            "direction" : wheelPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.wheelWidth
        });`;
  return {
    featureName: "swerveModule",
    featureLabel: "Swerve Module",
    code: buildLocalFeatureScriptFile({ featureName: "swerveModule", featureLabel: "Swerve Module", precondition, body }),
    strategy: "Deterministic operation compiler generated a multi-body swerve module with base plate, steering bearing ring, fork/motor blocks, and wheel/shaft interface; no single-cylinder fallback.",
  };
}

function buildLocalSimpleBox(prompt, dims) {
  const precondition = [
    preconditionPlane(),
    preconditionLength("width", "Width", 0.25, dims.widthInches || 2, 96),
    preconditionLength("height", "Height", 0.25, dims.heightInches || 2, 96),
    preconditionLength("depth", "Depth", 0.25, dims.depthInches || 1, 96),
  ].join("\n");
  const body = `${planeVar()}
        var halfW = definition.width / 2;
        var halfH = definition.height / 2;
        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
${fsRect("baseSketch", "boxProfile", "-halfW", "-halfH", "halfW", "halfH")}
        skSolve(baseSketch);
        opExtrude(context, id + "boxBody", {
            "entities"  : qSketchRegion(id + "baseSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.depth
        });`;
  return {
    featureName: dims.featureName || "parametricBox",
    featureLabel: dims.featureLabel || "Parametric Box",
    code: buildLocalFeatureScriptFile({ featureName: dims.featureName || "parametricBox", featureLabel: dims.featureLabel || "Parametric Box", precondition, body }),
    strategy: "Deterministic operation compiler generated a direct solved-sketch extrusion with exposed dimensions.",
  };
}

function buildLocalRobustFeatureScript(prompt, dims, decomposition = null, retrieval = null, learningContext = {}) {
  const operationPlan = buildDeterministicOperationPlan(prompt, dims, decomposition, retrieval);
  const result = compileOperationPlanToFeatureScript(operationPlan, prompt, dims, retrieval);
  if (!result?.code) return null;
  const code = sanitizeFeatureScript(result.code).code;
  const validationIssues = validateFeatureScript(code);
  const fatalIssues = hasFatalFeatureScriptPatterns(code);
  const downstreamOps = (code.match(/\bop(Extrude|Revolve|Loft|Sweep|Boolean|Fillet|Chamfer|Pattern)\s*\(/g) || []).length;
  const complex = isComplexAssemblyPrompt(prompt);
  const localRetrieval = retrieval || buildLocalRetrievalFallback(prompt, dims, learningContext, decomposition);

  if (complex && downstreamOps < 3) {
    return {
      ...result,
      code: "",
      blockers: ["Deterministic operation compiler refused to collapse a complex assembly into too few operations."],
      retrieval: localRetrieval,
    };
  }
  // Only block on truly fatal issues — non-fatal validation warnings should not prevent delivery.
  if (fatalIssues.length) {
    return {
      ...result,
      code: "",
      blockers: [
        ...fatalIssues.map(issue => issue.message),
        ...validationIssues.slice(0, 2).map(issue => `Warning: ${issue.message}`),
      ],
      retrieval: localRetrieval,
    };
  }
  return {
    ...result,
    code,
    operationPlan,
    retrieval: localRetrieval,
    validationIssues,
    fatalIssues,
    strategy: `${result.strategy} Source precedence: ${sourcePrecedenceList().join(" -> ")}.`,
  };
}

function buildCompletedLocalResult(prompt, dims, learningContext, orchestration, localResult, reason = "") {
  const retrieval = localResult.retrieval || buildLocalRetrievalFallback(prompt, dims, learningContext);
  const warnings = uniqueStrings(localResult.warnings || []);
  const omissions = uniqueStrings(localResult.omissions || []);
  const completedOrchestration = {
    ...(orchestration || {}),
    status: "completed",
    completionLevel: omissions.length ? "partial" : "full",
    failedPass: null,
    localRepair: {
      status: "completed",
      reason,
      strategy: localResult.strategy,
    },
    keySlotsUsed: buildKeySlotUsage(),
    provenance: {
      dbRows: normalizeRetrievedRows(retrieval.dbRows || [], "db"),
      datasetRows: normalizeRetrievedRows(retrieval.datasetRows || [], "dataset"),
      sourceRows: normalizeRetrievedRows(retrieval.sourceRows || [], "source"),
      operationRows: normalizeRetrievedRows(retrieval.operationRows || [], "operation"),
      tab_citations: Array.isArray(learningContext.tabCitations) ? learningContext.tabCitations : [],
    },
    blockers: [],
    warnings,
    omissions,
  };
  if (!completedOrchestration.passes) completedOrchestration.passes = {};
  completedOrchestration.passes.operationCompiler = {
    status: "completed",
    strategy: localResult.strategy,
  };
  const thinking = buildThinkingTrace(prompt, dims, {
    generationMode: omissions.length ? "four_pass_operation_compiler_partial" : "four_pass_operation_compiler",
    learningExamples: learningContext.examples.length,
    customReasoning: localResult.strategy,
    orchestration: completedOrchestration,
  });
  return {
    code: localResult.code,
    featureName: localResult.featureName || dims.featureName,
    featureLabel: localResult.featureLabel || dims.featureLabel,
    thinking,
    dims,
    generationMode: omissions.length ? "four_pass_operation_compiler_partial" : "four_pass_operation_compiler",
    completionLevel: omissions.length ? "partial" : "full",
    warnings,
    omissions,
    orchestration: completedOrchestration,
  };
}

// Helper: Generate FeatureScript using AI deep thinking (no templates)
async function generateWithAiThinking(prompt, dims, learningContext, requestId) {
  try {
    console.warn(`[AI] Generating FeatureScript with deep thinking (recovery path) for request=${requestId}`);
    const recoveryPrompt = `USER REQUEST: ${prompt}

DIMENSIONS:
${JSON.stringify({
  featureName: dims.featureName,
  shape: dims.shape,
  widthInches: dims.widthInches,
  heightInches: dims.heightInches,
  depthInches: dims.depthInches,
  radiusInches: dims.radiusInches,
  holeRadiusInches: dims.holeRadiusInches,
  filletRadiusInches: dims.filletRadiusInches,
}, null, 2)}

INSTRUCTIONS:
- Generate complete, compile-safe FeatureScript 2931 code for the requested shape
- Use deep thinking to analyze the request and determine the best approach
- Expose user-editable parameters in the precondition
- Follow all FeatureScript naming conventions and syntax rules
- Return only JSON with featureName, featureLabel, reasoning, and code fields
- Never block — always produce valid, working code even if simplified`;

    const raw = await chat(
      [
        { role: "system", content: withLearningContext(CUSTOM_FEATURE_SYSTEM, learningContext) },
        { role: "user", content: recoveryPrompt }
      ],
      COMPLEX_MODEL,
      [TEXT_MODEL, FALLBACK_MODEL],
      {
        stage: "generation",
        affinity: `${requestId}:ai_thinking_recovery`,
        keySlot: "k7",
        maxCompletionTokens: Math.min(GROQ_MAX_COMPLETION_TOKENS, 6000),
      }
    );

    const parsed = tryParseJson(raw, null);
    if (!parsed || !parsed.code) {
      console.warn(`[AI] AI thinking recovery produced invalid JSON; falling back to operation compiler`);
      return null;
    }

    const { code, featureName, featureLabel, reasoning } = parsed;
    const sanitized = sanitizeFeatureScript(code);
    return {
      code: sanitized.code,
      featureName: featureName || dims.featureName,
      featureLabel: featureLabel || dims.featureLabel,
      reasoning: reasoning || "Generated with AI deep thinking during recovery.",
      warnings: sanitized.warnings || [],
    };
  } catch (err) {
    console.warn(`[AI] AI thinking recovery failed: ${err?.message || String(err).slice(0, 100)}`);
    return null;
  }
}

function buildChatbotRetrievalBundle(prompt, dims, learningContext = {}) {
  const promptKeywords = extractPromptKeywords(prompt, 14);
  const knowledgeRows = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const featureScriptDocs = Array.isArray(learningContext.featureScriptDocs) ? learningContext.featureScriptDocs : [];
  const dbRows = selectTraceableRows(
    knowledgeRows.filter(row => !String(row.memory_type || "").includes("dataset") && !String(row.source_table || "").includes("source_docs")),
    promptKeywords,
    promptKeywords,
    8,
    "db"
  );
  const datasetRows = selectTraceableRows(
    [
      ...knowledgeRows.filter(row => String(row.memory_type || "").includes("dataset")),
      ...loadDatasetSummaryRows(),
    ],
    promptKeywords,
    promptKeywords,
    8,
    "dataset"
  );
  const sourceRows = selectTraceableRows(
    [
      ...knowledgeRows.filter(row => String(row.source_table || "").includes("source_docs")),
      ...loadSourceKnowledgeRows(),
    ],
    promptKeywords,
    promptKeywords,
    8,
    "source"
  );
  const docRows = featureScriptDocs.slice(0, 4).map((doc, index) => ({
    title: doc.title || `FeatureScript Doc ${index + 1}`,
    summary: normalizeText(doc.text || "").slice(0, 420),
    source_table: "fs_docs",
    source_type: "local_fs_doc",
    operation_tags: [],
    component_tags: [],
    kind: "doc",
  }));

  return {
    dbRows,
    datasetRows,
    sourceRows,
    docRows,
    summaries: {
      db: summarizeTraceableRows(dbRows),
      dataset: summarizeTraceableRows(datasetRows),
      source: summarizeTraceableRows(sourceRows),
      docs: docRows.map(row => row.title).join(" | "),
    },
  };
}

function buildChatbotCandidatePrompt({ prompt, dims, retrieval, candidateId, preferSimple = false }) {
  const styleHints = {
    c1: "Prioritize rich geometry, editable parameters, and strong operation sequencing.",
    c2: "Prioritize compile-safe FeatureScript API usage and conservative query construction.",
    c3: "Prioritize 3D-printable geometry, smooth but stable finishing, and no thin unsupported details.",
    c4: "Prioritize clean parameterization so user edits actually change the resulting geometry.",
    repair: "Rewrite the model more conservatively while preserving intent and editable dimensions.",
    simplify: "Return a simplified but compile-safe version of the requested part that still respects the main prompt.",
  };

  return [
    `USER REQUEST: ${prompt}`,
    `DIMENSIONS: ${summarizeDimsForPrompt(dims)}`,
    `CANDIDATE MODE: ${candidateId}`,
    `STYLE HINT: ${styleHints[candidateId] || styleHints.c1}`,
    `DOC_ROWS: ${JSON.stringify(retrieval.docRows.slice(0, 4))}`,
    `DB_ROWS: ${JSON.stringify(compactPromptRows(retrieval.dbRows, 5))}`,
    `DATASET_ROWS: ${JSON.stringify(compactPromptRows(retrieval.datasetRows, 5))}`,
    `SOURCE_ROWS: ${JSON.stringify(compactPromptRows(retrieval.sourceRows, 5))}`,
    preferSimple
      ? "OUTPUT POLICY: simplify the geometry if needed, but always keep the result editable, compile-oriented, and structurally faithful to the user intent."
      : "OUTPUT POLICY: aim for the most detailed compile-safe FeatureScript you can produce while keeping all major requested geometry editable.",
    "HARD RULES:",
    "- Return JSON only with featureName, featureLabel, reasoning, and code.",
    "- Always expose editable parameters in precondition.",
    "- Use FeatureScript docs and retrieved rows as ground truth for API names and operation order.",
    "- Never return an empty code field.",
    "- If the request is complex, preserve the main components first and safely omit secondary details rather than inventing unsafe API calls.",
  ].join("\n");
}

function parseFeatureScriptJson(raw, dims) {
  const parsed = tryParseJson(raw, null);
  if (parsed?.code) {
    return {
      featureName: parsed.featureName || dims.featureName,
      featureLabel: parsed.featureLabel || dims.featureLabel,
      reasoning: parsed.reasoning || "",
      code: parsed.code,
    };
  }

  const stripped = String(raw || "")
    .replace(/```(?:featurescript|fs|json|javascript)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  if (/FeatureScript\s+2931\s*;/.test(stripped)) {
    return {
      featureName: dims.featureName,
      featureLabel: dims.featureLabel,
      reasoning: "The model returned raw FeatureScript instead of JSON, so it was recovered directly.",
      code: stripped,
    };
  }

  return null;
}

function scoreFeatureScriptCandidate(code) {
  const sanitized = sanitizeFeatureScript(code).code;
  const localIssues = validateFeatureScript(sanitized);
  const fatalIssues = hasFatalFeatureScriptPatterns(sanitized);
  const exportCount = (sanitized.match(/\bexport const\b/g) || []).length;
  const hasPrecondition = /precondition[\s\S]*definition\./.test(sanitized);
  const score =
    (sanitized.length > 80 ? 100 : 0)
    + (exportCount === 1 ? 15 : -20)
    + (hasPrecondition ? 10 : -20)
    - localIssues.length * 4
    - fatalIssues.length * 12;

  return { sanitized, localIssues, fatalIssues, score };
}

async function generateChatbotCandidates(prompt, dims, learningContext, retrieval, requestId) {
  const slots = ["k3", "k4", "k5", "k6"].slice(0, Math.max(1, Math.min(CAD_CANDIDATE_COUNT, 4)));
  const candidateIds = slots.map((_, index) => `c${index + 1}`);
  const settled = await Promise.allSettled(candidateIds.map((candidateId, index) => chat([
    { role: "system", content: withLearningContext(CUSTOM_FEATURE_SYSTEM, learningContext) },
    { role: "user", content: buildChatbotCandidatePrompt({ prompt, dims, retrieval, candidateId }) },
  ], promptNeedsHighFidelityModel(prompt) ? COMPLEX_MODEL : TEXT_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
    stage: "generation",
    affinity: `${requestId}:chatbot:${candidateId}`,
    keySlot: slots[index],
    maxCompletionTokens: Math.min(GROQ_MAX_COMPLETION_TOKENS, 5200),
  })));

  return settled.map((item, index) => {
    const candidateId = candidateIds[index];
    if (item.status !== "fulfilled") {
      return {
        candidateId,
        ok: false,
        error: item.reason?.message || "candidate_failed",
        score: -999,
        code: "",
        reasoning: "",
        localIssues: [],
        fatalIssues: [],
      };
    }

    const parsed = parseFeatureScriptJson(item.value, dims);
    if (!parsed?.code) {
      return {
        candidateId,
        ok: false,
        error: "candidate_invalid_json",
        score: -999,
        code: "",
        reasoning: "",
        localIssues: [],
        fatalIssues: [],
      };
    }

    const scored = scoreFeatureScriptCandidate(parsed.code);
    return {
      candidateId,
      ok: true,
      featureName: parsed.featureName,
      featureLabel: parsed.featureLabel,
      reasoning: parsed.reasoning,
      code: scored.sanitized,
      score: scored.score,
      localIssues: scored.localIssues,
      fatalIssues: scored.fatalIssues,
    };
  }).sort((a, b) => b.score - a.score);
}

async function runRepairCycle(code, learningContext, maxAttempts = CAD_REPAIR_ATTEMPTS) {
  let workingCode = sanitizeFeatureScript(code).code;
  let localIssues = validateFeatureScript(workingCode);
  let fatalIssues = hasFatalFeatureScriptPatterns(workingCode);
  const explanations = [];
  let repaired = false;

  for (let attempt = 0; attempt < maxAttempts && (localIssues.length || fatalIssues.length); attempt += 1) {
    const issueText = [
      ...localIssues.map(issue => `Line ${issue.line || "?"}: ${issue.message}`),
      ...fatalIssues.map(issue => `Fatal: ${issue.message}`),
    ].slice(0, 16).join("\n");

    const repair = await debugFeatureScript(workingCode, issueText, {
      learningContext,
      stage: "repair",
      affinity: `repair:${stableHash(workingCode)}:${attempt}`,
    });
    if (!repair?.fixed) break;
    workingCode = sanitizeFeatureScript(repair.fixed).code;
    explanations.push(repair.explanation || `Repair pass ${attempt + 1} applied.`);
    repaired = true;
    localIssues = validateFeatureScript(workingCode);
    fatalIssues = hasFatalFeatureScriptPatterns(workingCode);
  }

  return { code: workingCode, localIssues, fatalIssues, repaired, explanations };
}

async function generateSimplifiedCandidate(prompt, dims, learningContext, retrieval, requestId) {
  const raw = await chat([
    { role: "system", content: withLearningContext(CUSTOM_FEATURE_SYSTEM, learningContext) },
    { role: "user", content: buildChatbotCandidatePrompt({ prompt, dims, retrieval, candidateId: "simplify", preferSimple: true }) },
  ], COMPLEX_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
    stage: "generation",
    affinity: `${requestId}:chatbot:simplify`,
    keySlot: "k9",
    maxCompletionTokens: Math.min(GROQ_MAX_COMPLETION_TOKENS, 4800),
  });
  return parseFeatureScriptJson(raw, dims);
}

function buildGearTemplateResult(prompt, dims, learningContext, retrieval, warnings = []) {
  const code = buildFeatureScript({ ...dims, shape: "GEAR_SPUR" });
  const orchestration = {
    status: "completed",
    completionLevel: "simplified",
    failedPass: null,
    keySlotsUsed: buildKeySlotUsage(),
    passes: {
      intent: { shape: dims.shape, confidence: dims.confidence },
      retrieval: { summaries: retrieval.summaries },
      generation: { selectedCandidateId: "gear_template_fallback" },
      repair: { repaired: false, explanation: [] },
      fallback: { used: "gear_template" },
    },
    provenance: {
      dbRows: normalizeRetrievedRows(retrieval.dbRows, "db"),
      datasetRows: normalizeRetrievedRows(retrieval.datasetRows, "dataset"),
      sourceRows: normalizeRetrievedRows(retrieval.sourceRows, "source"),
      docRows: retrieval.docRows || [],
    },
    warnings,
    omissions: ["Returned the dedicated spur gear fallback because AI candidates were not compile-safe."],
  };

  return {
    code,
    featureName: dims.featureName,
    featureLabel: dims.featureLabel,
    thinking: buildThinkingTrace(prompt, dims, {
      generationMode: "gear_template_fallback",
      learningExamples: learningContext.examples.length,
      orchestration,
    }),
    dims,
    generationMode: "gear_template_fallback",
    completionLevel: "simplified",
    warnings,
    omissions: orchestration.omissions,
    orchestration,
  };
}

// ─── Public: Generate ─────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt, options = {}) {
  console.log(`[AI] Generating: "${prompt}"`);

  const learningContext = normalizeLearningContext(options.learningContext);
  const history = Array.isArray(options.history) ? options.history : [];
  const requestId = options.requestId || makeRequestId(prompt);
  const dims = applyPromptHeuristics(prompt, await extractDims(prompt, learningContext, history, { requestId }));
  console.log(`[AI] shape=${dims.shape} confidence=${dims.confidence}`);

  const mathAnalysis = performGeometricReasoning(dims);
  learningContext.notes.push(`Geometric Reasoning: ${mathAnalysis}`);

  try {
    const retrieval = buildChatbotRetrievalBundle(prompt, dims, learningContext);
    const candidates = await generateChatbotCandidates(prompt, dims, learningContext, retrieval, requestId);
    const bestCandidate = candidates[0] || null;

    let selectedCode = bestCandidate?.code || "";
    let selectedFeatureName = bestCandidate?.featureName || dims.featureName;
    let selectedFeatureLabel = bestCandidate?.featureLabel || dims.featureLabel;
    let selectedReasoning = bestCandidate?.reasoning || "The chatbot generator assembled a FeatureScript candidate from retrieved docs, memory rows, and dataset hints.";
    let generationModeLabel = "multi_key_detailed";
    let completionLevel = "full";
    let warnings = [];
    let omissions = [];
    let repairSummary = { repaired: false, explanation: [], localIssues: [], fatalIssues: [] };
    let fallbackUsed = "none";

    if (selectedCode) {
      repairSummary = await runRepairCycle(selectedCode, learningContext);
      selectedCode = repairSummary.code;
      if (repairSummary.repaired) {
        generationModeLabel = "multi_key_repaired";
        completionLevel = "repaired";
      }
    }

    if (!selectedCode || repairSummary.localIssues.length || repairSummary.fatalIssues.length) {
      const simplified = await generateSimplifiedCandidate(prompt, dims, learningContext, retrieval, requestId)
        .catch(() => null);
      if (simplified?.code) {
        const simplifiedRepair = await runRepairCycle(simplified.code, learningContext, 1);
        if (simplifiedRepair.code) {
          selectedCode = simplifiedRepair.code;
          selectedFeatureName = simplified.featureName || selectedFeatureName;
          selectedFeatureLabel = simplified.featureLabel || selectedFeatureLabel;
          selectedReasoning = simplified.reasoning || selectedReasoning;
          repairSummary = simplifiedRepair;
          generationModeLabel = "multi_key_simplified";
          completionLevel = "simplified";
          fallbackUsed = "ai_simplification";
          omissions.push("Secondary details may have been simplified to preserve compile safety and editability.");
        }
      }
    }

    if ((!selectedCode || repairSummary.fatalIssues.length) && dims.shape === "GEAR_SPUR" && canUseTemplateFallback(dims)) {
      return buildGearTemplateResult(prompt, dims, learningContext, retrieval, [
        "Used the retained spur gear fallback because AI-generated gear candidates were not compile-safe.",
      ]);
    }

    if (!selectedCode && bestCandidate?.code) {
      selectedCode = bestCandidate.code;
      generationModeLabel = "recovery_failed";
      completionLevel = "partial";
      warnings.push("Returned the best sanitized AI candidate even though some validator issues remain.");
      omissions.push("Automatic repair and simplification did not fully resolve all validator issues.");
    }

    if (!selectedCode) {
      const aiRecovery = await generateWithAiThinking(prompt, dims, learningContext, requestId);
      if (aiRecovery?.code) {
        const recovered = await runRepairCycle(aiRecovery.code, learningContext, 1);
        selectedCode = recovered.code || aiRecovery.code;
        selectedFeatureName = aiRecovery.featureName || selectedFeatureName;
        selectedFeatureLabel = aiRecovery.featureLabel || selectedFeatureLabel;
        selectedReasoning = aiRecovery.reasoning || selectedReasoning;
        repairSummary = recovered;
        generationModeLabel = "multi_key_simplified";
        completionLevel = "simplified";
        fallbackUsed = "ai_recovery";
        omissions.push("Returned the recovery candidate after the main candidate set failed.");
      }
    }

    if (!selectedCode) {
      warnings.push("No compile-safe FeatureScript could be produced. Returning an empty code payload was avoided where possible, but all recovery paths failed.");
      completionLevel = "partial";
      generationModeLabel = "recovery_failed";
    }

    if (repairSummary.localIssues.length) {
      warnings.push(`Validator still reports ${repairSummary.localIssues.length} issue(s).`);
    }
    if (repairSummary.fatalIssues.length) {
      warnings.push(`Fatal validator checks still report ${repairSummary.fatalIssues.length} issue(s).`);
    }
    if (repairSummary.repaired) {
      warnings.push("Automatic repair was applied to improve FeatureScript correctness.");
    }

    const orchestration = {
      status: "completed",
      completionLevel,
      failedPass: null,
      keySlotsUsed: buildKeySlotUsage(),
      passes: {
        intent: {
          shape: dims.shape,
          confidence: dims.confidence,
          dimensions: summarizeDimsForPrompt(dims),
        },
        retrieval: {
          summaries: retrieval.summaries,
          docRows: retrieval.docRows.map(row => row.title),
        },
        generation: {
          selectedCandidateId: bestCandidate?.candidateId || "none",
          candidateScores: candidates.map(candidate => ({
            candidateId: candidate.candidateId,
            score: candidate.score,
            ok: candidate.ok,
            issueCount: candidate.localIssues?.length || 0,
            fatalCount: candidate.fatalIssues?.length || 0,
          })),
        },
        repair: {
          repaired: repairSummary.repaired,
          explanation: repairSummary.explanations || [],
        },
        fallback: {
          used: fallbackUsed,
        },
      },
      provenance: {
        dbRows: normalizeRetrievedRows(retrieval.dbRows, "db"),
        datasetRows: normalizeRetrievedRows(retrieval.datasetRows, "dataset"),
        sourceRows: normalizeRetrievedRows(retrieval.sourceRows, "source"),
        docRows: retrieval.docRows,
      },
      warnings,
      omissions,
      validation: {
        localIssueCount: repairSummary.localIssues.length,
        fatalIssueCount: repairSummary.fatalIssues.length,
        repaired: repairSummary.repaired,
      },
    };

    const thinking = buildThinkingTrace(prompt, dims, {
      generationMode: generationModeLabel,
      learningExamples: learningContext.examples.length,
      customReasoning: selectedReasoning,
      orchestration,
    });

    return {
      code: selectedCode,
      featureName: selectedFeatureName,
      featureLabel: selectedFeatureLabel,
      thinking,
      dims,
      generationMode: generationModeLabel,
      completionLevel,
      warnings,
      omissions,
      orchestration,
    };
  } catch (err) {
    console.error("[AI] Chatbot generation failed.", err?.message || String(err));
    const retrieval = buildChatbotRetrievalBundle(prompt, dims, learningContext);
    if (dims.shape === "GEAR_SPUR" && canUseTemplateFallback(dims)) {
      return buildGearTemplateResult(prompt, dims, learningContext, retrieval, [
        `Main chatbot generation failed: ${String(err?.message || "unknown").slice(0, 100)}`,
      ]);
    }

    const aiRecovery = await generateWithAiThinking(prompt, dims, learningContext, requestId);
    const repaired = aiRecovery?.code ? await runRepairCycle(aiRecovery.code, learningContext, 1) : null;
    const recoveryCode = repaired?.code || aiRecovery?.code || "";
    const warnings = [`Main chatbot generation failed: ${String(err?.message || "unknown").slice(0, 100)}`];
    if (repaired?.repaired) warnings.push("Recovery code was automatically repaired.");
    if (!recoveryCode) warnings.push("All AI recovery paths failed.");
    const omissions = recoveryCode
      ? ["Returned the best available recovery candidate after a generation failure."]
      : ["No FeatureScript could be produced by the main or recovery paths."];
    const orchestration = {
      status: "completed",
      completionLevel: recoveryCode ? "simplified" : "partial",
      failedPass: "generation",
      keySlotsUsed: buildKeySlotUsage(),
      passes: {
        intent: {
          shape: dims.shape,
          confidence: dims.confidence,
          dimensions: summarizeDimsForPrompt(dims),
        },
        retrieval: {
          summaries: retrieval.summaries,
          docRows: retrieval.docRows.map(row => row.title),
        },
        generation: {
          selectedCandidateId: "recovery",
          candidateScores: [],
        },
        repair: {
          repaired: Boolean(repaired?.repaired),
          explanation: repaired?.explanations || [],
        },
        fallback: {
          used: recoveryCode ? "ai_recovery" : "none",
        },
      },
      provenance: {
        dbRows: normalizeRetrievedRows(retrieval.dbRows, "db"),
        datasetRows: normalizeRetrievedRows(retrieval.datasetRows, "dataset"),
        sourceRows: normalizeRetrievedRows(retrieval.sourceRows, "source"),
        docRows: retrieval.docRows,
      },
      warnings,
      omissions,
      validation: {
        localIssueCount: repaired?.localIssues?.length || 0,
        fatalIssueCount: repaired?.fatalIssues?.length || 0,
        repaired: Boolean(repaired?.repaired),
      },
    };

    return {
      code: recoveryCode,
      featureName: aiRecovery?.featureName || dims.featureName,
      featureLabel: aiRecovery?.featureLabel || dims.featureLabel,
      thinking: buildThinkingTrace(prompt, dims, {
        generationMode: recoveryCode ? "multi_key_simplified" : "recovery_failed",
        customReasoning: aiRecovery?.reasoning || `Main chatbot generation failed: ${String(err?.message || "unknown").slice(0, 100)}`,
        orchestration,
      }),
      dims,
      generationMode: recoveryCode ? "multi_key_simplified" : "recovery_failed",
      completionLevel: recoveryCode ? "simplified" : "partial",
      warnings,
      omissions,
      orchestration,
    };
  }
}

// ─── Public: Debug ────────────────────────────────────────────────────────────
// The debug function must know correct FeatureScript syntax precisely.
// Common wrong fixes the AI tries that we must prevent:
//   - "definition.radius is Length" → WRONG, Length is not a type
//   - Adding startAngle/endAngle to cylinder creation calls → those params don't exist
//   - Changing hardcoded * inch values to definition.param * inch → wrong if param isn't isLength

const DEBUG_SYSTEM = ` DEBUG SYSTEM: You are a FeatureScript repair assistant.
Input: { code, issues }.
For each issue:
- typed_lambda_or_typed_param: remove all "is <type>" annotations from function parameter lists and typed lambdas.
- array_length_indexing: replace dynamic length-based indexing with safe fixed-index logic or rewrite to use slice/pop semantics; prefer explicit indices when array length is known. If array length is unknown, add a defensive guard and a comment explaining the assumption.
- opCylinder_positional_args: replace unsupported opCylinder usage with fCylinder(...) or sketch + extrude.
- qSketchRegion_variable: replace with qSketchRegion("<sketchId>") where <sketchId> matches the created sketch id; if sketch id cannot be inferred, add a TODO comment and return diagnostics.
- missing_skSolve: insert skSolve(sketchVar) immediately after the sketch creation block.
- missing_precondition: add or restore the precondition block with isLength/isInteger/boolean declarations for all definition.* parameters used in the body.
Always:
- Preserve precondition parameter exposure; do not remove isLength/isInteger/boolean declarations.
- Add a short comment above each automated fix explaining the change and why it was safe.
- Return JSON: { fixed: "<full_fixed_code>", explanation: ["<step1>", "<step2>", ...], warnings: ["..."] }.
If you cannot deterministically fix an issue, return { fixed: null, explanation: [], warnings: ["cannot fix: reason"] }.

FEATURESCRIPT API FACTS (use these exactly, do not invent):

PRECONDITION EXACT SYNTAX:
  Length:   isLength(definition.width, LENGTH_BOUNDS);
  Integer:  isInteger(definition.count, {(unitless) : [1, 10, 200]});
  Degrees:  isInteger(definition.angleDeg, {(unitless) : [10, 20, 30]}); then use definition.angleDeg * PI / 180 in the body
  Boolean:  definition.addBore is boolean;
  Query:    definition.location is Query;
  NEVER:    isInteger(definition.x);
  NEVER:    definition.x is number;
  NEVER:    definition.x >= N;

Cylinders — use one of these valid patterns:
  fCylinder(context, id + "cyl1", {
      "bottomCenter" : skPlane.origin,
      "topCenter"    : skPlane.origin + skPlane.normal * definition.height,
      "radius"       : definition.radius
  });
  Or use sketch + extrude:
  var cylSk = newSketchOnPlane(context, id + "cylSk", { "sketchPlane" : skPlane });
  skCircle(cylSk, "cyl", { "center" : vector(0, 0) * inch, "radius" : definition.radius });
  skSolve(cylSk);
  opExtrude(context, id + "cyl1", {
      "entities"  : qSketchRegion(id + "cylSk"),
      "direction" : skPlane.normal,
      "endBound"  : BoundingType.BLIND,
      "endDepth"  : definition.height
  });

isLength in precondition:
  annotation { "Name" : "My Param", "Default" : "1 * inch" }
  isLength(definition.myParam, LENGTH_BOUNDS);
  "definition.myParam is Length" is WRONG — Length is not a type specifier.

newSketchOnPlane (for user-selected planes, not newSketch):
  var sk = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });

Plane from user selection:
  var skPlane = isQueryEmpty(context, definition.location)
      ? plane(WORLD_ORIGIN, Z_DIRECTION)
      : evPlane(context, { "face" : definition.location });

When definition.param is declared with isLength() in precondition, it already has Length type.
  DO NOT multiply by * inch in the body. Use definition.param directly as a Length value.
  WRONG: "endDepth" : definition.depth * inch
  RIGHT: "endDepth" : definition.depth

opExtrude direction: use skPlane.normal (a Vector) or a constant like Z_DIRECTION, X_DIRECTION, Y_DIRECTION.
  Never use evPlane(...).normal inline — assign evPlane to a variable first.

opRevolve: { "entities": Query, "axis": Line, "angleForward": Angle (use 2 * PI * radian for full) }
  The axis must be a Line value, not qSketchEntity(...) or qCreatedBy(...).

qSketchRegion:
  qSketchRegion(id + "sketch1")
  qSketchRegion(id + "sketch1", true)
  NEVER: qSketchRegion(sketch1)
  NEVER: qSketchRegion(sk)

opBoolean: { "tools": Query, "targets": Query, "operationType": BooleanOperationType.UNION|SUBTRACTION }

skRegularPolygon: { "center": Vector, "firstVertex": Vector, "sides": integer }
  (not skPolygon — that function does not exist)

skFitSpline: valid sketch spline API
  skFitSpline(sketch, "spline1", { "points": [...] })
  "skSpline" is not a valid sketch API name.
  For organic profiles such as carrots, use at least 4 control points on the spline side.

UNUSED VARIABLES:
  If the compiler says "Variable X set but not used", delete that variable and any dead calculations feeding it.

LAMBDA PARAMETER RULES (causes "Error in initializer function arguments"):
  Lambda parameters inside a feature body MUST be untyped — no "is type" annotations.
  WRONG: const f = function(t is number, rb is number) { ... }
  WRONG: const f = function(p, a is number) { ... }   ← even one typed param breaks it
  RIGHT: const f = function(t, rb) { ... }
  RIGHT: const f = function(p, a) { ... }
  The "is type" syntax is only valid in top-level named functions, not lambdas.

FOR LOOP VARIABLES:
  Inside a for/while/if block body, use var, not const.
  WRONG: for (var k = 0; ...) { const x = ...; }
  RIGHT: for (var k = 0; ...) { var x = ...; }
  FeatureScript const is only valid at the top level of the feature body.

INCREMENT/DECREMENT:
  FeatureScript has NO ++ or -- operators. They cause "no viable alternative" parse errors.
  WRONG: k++   WRONG: i--
  RIGHT: k += 1   RIGHT: i -= 1

ARRAY LENGTH:
  FeatureScript arrays have NO .length property.
  WRONG: arr[arr.length - 1]
  RIGHT: use a hardcoded index like arr[5] when the size is known, or track it with a counter.

FUNCTION SCOPE RULE (causes "missing TOP_SEMI" and "no viable alternative" parse errors):
  Named typed top-level functions are ONLY legal at MODULE TOP LEVEL.
  Inside a feature body (the lambda passed to defineFeature) they are ILLEGAL.
  WRONG — causes parse errors:
    function invPoint(t is number, rb is number) returns vector { ... }
  RIGHT — const lambda is legal inside a feature body (with UNTYPED params):
    const invPoint = function(t, rb) { ... };
  If the broken code has named functions inside the feature body, move them to module
  top level (before the annotation block) OR convert them to const lambda form with untyped params.

FIX RULES:
1. "definition.param is Length" → change to "isLength(definition.param, LENGTH_BOUNDS);" in precondition
2. opCylinder → replace with fCylinder or with skCircle + skSolve + opExtrude
3. definition.param * inch in body when param is isLength → remove the * inch
4. Raw number without units in geometry (e.g. "endDepth" : 2) → add * inch or use a definition param
5. newSketch used with evPlane result → change to newSketchOnPlane
6. skPolygon → skRegularPolygon
7. skSpline → skFitSpline
8. Multiple export const → keep only the last block
9. return statement with a value in feature body → delete it (features return undefined)
10. Named typed function inside feature body (function foo(...) returns T { }) →
    convert to const lambda: const foo = function(...) { }; at the top of the body,
    OR move to module top level before the annotation block
11. skSolve missing after sketch entities → add skSolve(sketch1); before opExtrude/opRevolve
12. qSketchRegion(sketchVariable) → replace with qSketchRegion(id + "sketch1", optionalTrueForInnerLoops)
13. qSketchEntity(...) or qCreatedBy(...) used as an opRevolve axis → replace with a Line value
14. variable set but not used → remove the variable and any dead helper math
15. gear generated with only concentric circles and no tooth flanks/arcs → replace with a closed tooth-profile strategy using splines/arcs or a robust spur gear example
16. two gears boolean-unioned into one body by default → keep them as separate bodies unless the prompt explicitly asks for a merged solid
17. k++ or i++ or k-- inside FeatureScript → replace with k += 1 or k -= 1; FS has no ++ or -- operators
18. typed lambda parameters like function(t is number, rb is number) → remove type annotations: function(t, rb); FS lambdas inside feature bodies require untyped params
19. const inside a for/while loop body → change to var; const is only valid at the direct top-level of the feature body, not inside nested blocks
20. arr[arr.length - 1] → FS arrays have no .length; use a hardcoded index (e.g. arr[5]) or track the count with a separate variable`;

export function validateFeatureScript(code) {
  const text = String(code || "");
  const lines = text.split(/\r?\n/);
  const issues = [];
  const featureSignatureRegex = /\bdefineFeature\s*\(\s*function\s*\(\s*context\s+is\s+Context\s*,\s*id\s+is\s+Id\s*,\s*definition\s+is\s+map\s*\)/;
  const addIssue = (line, message, snippet) => {
    issues.push({ line, message, text: String(snippet || "").trim() });
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/\bisInteger\s*\(\s*definition\.\w+\s*\)\s*;/.test(line)) {
      addIssue(lineNo, "isInteger() is missing the required FS 2931 bounds map.", line);
    }
    if (/\bisInteger\s*\(\s*definition\.\w+\s*,\s*\{\s*\(unitless\)\s*:\s*\[[^\]]+\]\s*\}\s*\)\s*;/.test(line)) {
      addIssue(lineNo, "Custom isInteger bounds should be typed as IntegerBoundSpec.", line);
    }
    if (/"startAngle"\s*:|"endAngle"\s*:/.test(line)) {
      addIssue(lineNo, "opCylinder startAngle/endAngle keys do not exist — remove them.", line);
    }
    if (/\bopLoft\s*\(/.test(text) && /"(edges|sections|vertices)"\s*:/.test(line)) {
      addIssue(lineNo, "Use opLoft profileSubqueries; old edges/sections/vertices keys are invalid here.", line);
    }
    if (/^\s*definition\.\w+\s+is\s+number\s*;/.test(line)) {
      addIssue(lineNo, "Use isInteger(..., {(unitless) : [...]}) instead of definition.x is number.", line);
    }
    if (/^\s*definition\.\w+\s*(>=|<=)\s*\d/.test(line)) {
      addIssue(lineNo, "Do not use bare >= or <= lines in preconditions; use an isInteger bounds map.", line);
    }
    if (/\bfunction\s*\([^)]*\bis\s+vector\b/i.test(line)) {
      addIssue(lineNo, "Lowercase vector is not a valid lambda type declaration.", line);
    }
    if (/\bfunction\s*\([^)]*\)\s+returns\s+(vector|array|map)\b/i.test(line)) {
      addIssue(lineNo, "Avoid lambda return-type annotations here; use an untyped const lambda.", line);
    }
    // FS has no ++ or -- operators — causes "no viable alternative" parse error
    if (/\b\w+\s*\+\+|\b\w+\s*--/.test(line) && !/\/\//.test(line.split('//')[0] || line)) {
      addIssue(lineNo, "FeatureScript has no ++ or -- operators. Use += 1 or -= 1.", line);
    }
    // Lambda parameters inside feature body CANNOT be typed — strips silently in sanitize
    // but flag here so the debug pass can also catch them before sanitize runs.
    if (/\bfunction\s*\([^)]*\s+is\s+(number|map|array|boolean|string)\b/.test(line) &&
        !/^\s*\/\//.test(line) &&
        !featureSignatureRegex.test(line)) {
      addIssue(lineNo, "Lambda parameters cannot have type annotations (e.g. 'x is number'). Use untyped params: function(x, y).", line);
    }
    // .length on FeatureScript arrays is invalid — FS has no .length property
    if (/\w+\s*\[\s*\w+\.length\b/.test(line) || /\.\blength\b/.test(line) && /\[/.test(line)) {
      addIssue(lineNo, "FeatureScript arrays have no .length property. Use a hardcoded index or size() if available.", line);
    }
    if (/\bqSketchRegion\s*\(\s*(sk|sketch\w*)\s*[),]/.test(line)) {
      addIssue(lineNo, "qSketchRegion expects the sketch id expression like id + \"sketch1\", not the sketch variable.", line);
    }
    if (/\bqSketchEntity\s*\(|\bqCreatedBy\s*\([^)]*(sk|sketch\w*)/.test(line)) {
      addIssue(lineNo, "Sketch queries are not valid opRevolve axes; construct a Line value instead.", line);
    }
    if (/\bopCylinder\s*\(/.test(line)) {
      addIssue(lineNo, "Unsupported opCylinder call — replace with fCylinder(...) or sketch + opExtrude.", line);
    }
    if (/\b(opCut|opBore|opPlateHoles)\s*\(/.test(line)) {
      addIssue(lineNo, "Unsupported helper operation detected. Use standard FeatureScript sketch, extrude, boolean, or query APIs instead.", line);
    }
    if (/\b(qEdges|qEdgeAll|qBodyFaces|qAllEdges)\s*\(/.test(line)) {
      addIssue(lineNo, "Unsupported edge/body helper detected. Use qOwnedByBody(...) and qEdgeTopologyFilter(...) patterns instead.", line);
    }
    if (/\bnewSketch\s*\([^)]*evPlane\s*\(\s*context\s*,\s*definition\.\w+/.test(line)) {
      addIssue(lineNo, "newSketch with raw definition face/plane selection is fragile here. Prefer newSketchOnPlane with a resolved skPlane variable.", line);
    }
    if (/evPlane\s*\(\s*context\s*,\s*definition\.\w+\s*\)/.test(line)) {
      addIssue(lineNo, "evPlane must receive a map such as { \"face\" : definition.location }.", line);
    }
    if (/\bopExtrude\s*\(/.test(line) && /"(profile|sketch|distance)"\s*:/.test(text)) {
      addIssue(lineNo, "opExtrude should use entities/direction/endBound/endDepth, not sketch/profile/distance shortcut keys.", line);
    }
    if (/\bvector\s*\(\s*definition\.\w+\s*(?:,|\))/.test(line) && !/\/\s*inch/.test(line) && /\*\s*inch/.test(line)) {
      addIssue(lineNo, "Length values used inside vector(...) must be converted to unitless numbers with / inch before multiplying the vector by * inch.", line);
    }
    if (/\bopFillet\s*\(/.test(line) && /qSketchRegion\s*\(/.test(text)) {
      addIssue(lineNo, "Fillet targets should come from body edge queries, not sketch region queries.", line);
    }
  });

  // Check that defineFeature has 'definition is map'
  if (/\bdefineFeature\s*\(\s*function\s*\(/.test(text) && !/\bdefinition\s+is\s+map\b/.test(text)) {
    addIssue(0, "defineFeature third parameter must be typed as 'definition is map' — the 'is map' annotation is missing or was stripped.", "(global)");
  }
  if (!/\}\s*\)\s*;\s*$/.test(text.trim())) {
    addIssue(0, "FeatureScript file appears truncated or missing the final defineFeature closure and semicolon.", "(global)");
  }

  const isLengthParams = new Set();
  lines.forEach(line => {
    const match = line.match(/\bisLength\(\s*definition\.(\w+)/);
    if (match) isLengthParams.add(match[1]);
  });
  lines.forEach((line, index) => {
    for (const param of isLengthParams) {
      if (new RegExp(`\\bdefinition\\.${param}\\s*\\*\\s*inch\\b`).test(line)) {
        addIssue(index + 1, `definition.${param} already has Length type; remove * inch.`, line);
      }
    }
  });

  const hasSketch = /\bnewSketchOnPlane\s*\(|\bnewSketch\s*\(/.test(text);
  const hasSolve = /\bskSolve\s*\(/.test(text);
  if (hasSketch && !hasSolve) {
    addIssue(0, "Sketch created without any skSolve() call.", "(global)");
  }

  const usesRevolveRegion = /\bopRevolve\s*\([\s\S]*?\bqSketchRegion\s*\(\s*id\s*\+\s*"[^"]+"\s*\)/.test(text);
  const hasSplineProfile = /\bskFitSpline\s*\(/.test(text);
  const lineSegmentCount = (text.match(/\bskLineSegment\s*\(/g) || []).length;
  if (usesRevolveRegion && hasSplineProfile && lineSegmentCount < 3) {
    addIssue(0, "Revolve profile likely open. Add explicit closing lines from the spline endpoints back to the axis so qSketchRegion(id + \"profile\") is non-empty.", "(global)");
  }

  const looksLikeGear = /\bgear\b/i.test(text) || /\bnumTeeth\w*\b/.test(text) || /\bpressureAngle\w*\b/.test(text);
  const circleCount = (text.match(/\bskCircle\s*\(/g) || []).length;
  const arcCount = (text.match(/\bskArc\s*\(/g) || []).length;
  if (looksLikeGear && circleCount >= 3 && !hasSplineProfile && arcCount === 0) {
    addIssue(0, "Gear geometry is over-simplified: concentric circles alone are not a valid finished spur gear tooth profile. Use involute-style flank splines with tip/root arcs or a robust gear example.", "(global)");
  }
  if (looksLikeGear && /\bopBoolean\s*\([\s\S]*?BooleanOperationType\.UNION/.test(text) && /\bid\s+\+\s*"ext1"/.test(text) && /\bid\s+\+\s*"ext2"/.test(text)) {
    addIssue(0, "Two generated gears were unioned into one body. Gear pairs should stay as separate bodies unless the prompt explicitly asks for a merged solid.", "(global)");
  }
  if (looksLikeGear && /\bsk(LineSegment|Arc)\s*\(/.test(text) && /\b(isInteger|isLength)\(\s*definition\./.test(text)) {
    const parameterNames = [...isLengthParams];
    const hardcodedSketch = parameterNames.length > 0 && !parameterNames.some(name => new RegExp(`\\bdefinition\\.${name}\\b`).test(text.split(/skSolve\s*\(/)[0] || text));
    if (hardcodedSketch) {
      addIssue(0, "Editable result preservation: gear geometry exposes parameters but the tooth sketch is still mostly hardcoded. Tie tooth/body geometry back to definition parameters.", "(global)");
    }
  }

  const declarationRegex = /^\s*(?:const|var)\s+([A-Za-z_]\w*)\s*=/;
  lines.forEach((line, index) => {
    const match = line.match(declarationRegex);
    if (!match) return;
    const name = match[1];
    const totalMentions = text.match(new RegExp(`\\b${name}\\b`, "g"))?.length || 0;
    if (totalMentions <= 1) {
      addIssue(index + 1, `Variable ${name} is declared but never used. Remove dead helper math.`, line);
    }
  });

  const bodyMatch = text.match(/defineFeature\s*\(\s*function\s*\([^)]*\)[^{]*\{[\s\S]*?\n\s*\{/);
  if (bodyMatch) {
    const bodyStart = text.indexOf(bodyMatch[0]) + bodyMatch[0].length;
    const bodyText = text.slice(bodyStart);
    const nestedFunction = bodyText.match(/\bfunction\s+[a-zA-Z_]\w*\s*\(/);
    if (nestedFunction) {
      const before = text.slice(0, bodyStart + nestedFunction.index);
      addIssue(before.split(/\r?\n/).length, "Named function detected inside feature body; use a const lambda instead.", nestedFunction[0]);
    }
  }

  return issues;
}

/**
 * hasFatalFeatureScriptPatterns
 * - Returns an array of { code: string, message: string, snippet?: string }
 * - Use this to decide whether to trigger the repair loop.
 */
export function hasFatalFeatureScriptPatterns(code) {
  const issues = [];
  const withoutFeatureSignature = String(code || "").replace(
    /\bdefineFeature\s*\(\s*function\s*\(\s*context\s+is\s+Context\s*,\s*id\s+is\s+Id\s*,\s*definition\s+is\s+map\s*\)/g,
    "defineFeature(function(ALLOWED_FEATURE_SIGNATURE)"
  );

  // 1) Missing precondition with isLength/isInteger/boolean
  if (!/precondition[\s\S]*?(isLength|isInteger|boolean)/.test(code)) {
    issues.push({ code: 'missing_precondition', message: 'Missing precondition block exposing parameters with isLength/isInteger/boolean.' });
  }

  // 2) Typed lambda or typed param annotations
  if (/\bfunction\s*\([^)]*\bis\s+/.test(withoutFeatureSignature)) {
    issues.push({ code: 'typed_lambda_or_typed_param', message: 'Typed parameter annotations detected (forbidden).' });
  }

  // 3) .length dynamic indexing
  if (/\.\s*length\b/.test(code)) {
    issues.push({ code: 'array_length_indexing', message: 'Dynamic array length indexing detected (forbidden).' });
  }

  // 4) legacy cylinder creator usage that still needs normalization
  if (/(?:opCylinder|fCylinder)\s*\(\s*[^,()]+,\s*[^,()]+,\s*[^({][^)]*\)/.test(code)) {
    issues.push({ code: 'opCylinder_positional_args', message: 'Cylinder primitive used with positional args; convert to a definition map.' });
  }

  if (/\bopCylinder\s*\(/.test(code)) {
    issues.push({ code: 'legacy_opCylinder_usage', message: 'Legacy opCylinder usage detected; replace it with fCylinder or a sketch/extrude workflow.' });
  }

  if (/\b(opCut|opBore|opPlateHoles)\s*\(/.test(code)) {
    issues.push({ code: 'unsupported_helper_operation', message: 'Unsupported helper operation detected; rewrite it using standard FeatureScript operations.' });
  }

  if (/\b(qEdges|qEdgeAll|qBodyFaces|qAllEdges)\s*\(/.test(code)) {
    issues.push({ code: 'unsupported_query_helper', message: 'Unsupported body/edge helper query detected; use qOwnedByBody and qEdgeTopologyFilter patterns.' });
  }

  if (/evPlane\s*\(\s*context\s*,\s*definition\.\w+\s*\)/.test(code)) {
    issues.push({ code: 'invalid_evPlane_usage', message: 'evPlane called with a raw definition property instead of a face map.' });
  }

  if (!/\}\s*\)\s*;\s*$/.test(String(code || "").trim())) {
    issues.push({ code: 'truncated_file', message: 'FeatureScript appears truncated or is missing the final defineFeature closure.' });
  }

  // 5) qSketchRegion called with variable
  if (/qSketchRegion\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\)/.test(code)) {
    issues.push({ code: 'qSketchRegion_variable', message: 'qSketchRegion called with a variable; must use explicit sketch id string.' });
  }

  // 6) Missing skSolve before downstream ops
  if (/(opExtrude|opRevolve|opLoft|opSweep)/.test(code) && !/skSolve\s*\(/.test(code)) {
    issues.push({ code: 'missing_skSolve', message: 'Downstream op found without skSolve present.' });
  }

  if (/\bvector\s*\(\s*definition\.\w+\s*(?:,|\))/.test(code) && /\*\s*inch/.test(code) && !/\/\s*inch/.test(code)) {
    issues.push({ code: 'length_inside_vector', message: 'Length values were inserted into vector(...) without conversion to unitless numbers.' });
  }

  if (/\bopExtrude\s*\([\s\S]*?"(profile|sketch|distance)"\s*:/.test(code)) {
    issues.push({ code: 'invalid_opExtrude_map', message: 'opExtrude uses unsupported shortcut keys like profile/sketch/distance.' });
  }

  return issues;
}

export async function debugFeatureScript(code, errors, options = {}) {
  const sanitizedInput = sanitizeFeatureScript(code).code;
  const learningContext = normalizeLearningContext(options.learningContext);
  console.log(`[AI] Debugging (${sanitizedInput.length} chars)`);

  try {
    const raw = await chat([
      { role: "system", content: withLearningContext(DEBUG_SYSTEM, learningContext) },
      { role: "user",   content: `FEATURESCRIPT:\n${sanitizedInput}\n\nONSHAPE ERRORS:\n${errors || "(none provided)"}` }
    ], COMPLEX_MODEL, [TEXT_MODEL, FALLBACK_MODEL], {
      stage: options.stage || "repair",
      affinity: options.affinity || `repair:${stableHash(sanitizedInput)}`,
    });
    const parsed = JSON.parse(stripJson(raw));
    const fixed = sanitizeFeatureScript(parsed.fixed || sanitizedInput).code;
    return { fixed, explanation: parsed.explanation || "Fixed." };
  } catch (err) {
    console.warn(`[AI] Debug fallback used: ${err.message}`);
    return { fixed: sanitizedInput, explanation: `Debug assistant unavailable. Returned sanitized original code unchanged. Reason: ${err.message}` };
  }
}

// ─── Public: Learning analysis ───────────────────────────────────────────────

const LEARNING_OUTCOME_SYSTEM = `You are the learning auditor for a CAD FeatureScript generator.
Return ONLY valid JSON with this schema:
{
  "summary": "one sentence about what happened",
  "whatWentWrong": "specific issue, or 'No issue reported'",
  "weightAdvice": "how the feedback should affect future retrieval weights",
  "nextPromptGuidance": "short guidance the generator should use next time",
  "memoryCandidate": {
    "title": "short unique CAD lesson title",
    "summary": "compact reusable lesson",
    "shapeType": "BOX | CYLINDER | PLATE | POLYGON | LINKAGE | PLATE_HOLES | L_BRACKET | T_BRACKET | FLANGE | HEX_NUT | WASHER | BUSHING | HITCH_PEG | GEAR_SPUR | CUSTOM",
    "tags": ["feedback"],
    "keywords": ["cad"],
    "parameterHints": [],
    "modelingNotes": [],
    "failureModes": [],
    "validationRules": [],
    "qualityScore": 0.55
  }
}

Judge the database snapshot, user feedback, compile/debug outcome, and prior memory matches.
Do not claim the base LLM weights changed. The app learns by saving memory rows and updating quality scores used for retrieval.
For bad outcomes, create a memoryCandidate that helps avoid the failure. For good outcomes, create a memoryCandidate that reinforces the successful modeling pattern.`;

function compactLearningSnapshot(snapshot = {}) {
  const diagnostics = snapshot.diagnostics || {};
  const tables = Array.isArray(diagnostics.tables)
    ? diagnostics.tables.map(table => ({
        table: table.table,
        available: table.available,
        count: table.count,
        error: table.error,
      }))
    : [];

  const generation = snapshot.generation
    ? {
        id: snapshot.generation.id,
        created_at: snapshot.generation.created_at,
        prompt: snapshot.generation.prompt,
        shape_type: snapshot.generation.shape_type,
        confidence: snapshot.generation.confidence,
        dims: snapshot.generation.dims,
        user_rating: snapshot.generation.user_rating,
        user_feedback: snapshot.generation.user_feedback,
        thinking: normalizeText(snapshot.generation.thinking || "").slice(0, 500),
      }
    : null;

  const memoryMatches = Array.isArray(snapshot.memoryMatches)
    ? snapshot.memoryMatches.slice(0, 5).map(match => ({
        score_rank: match.score_rank,
        score_snapshot: match.score_snapshot,
        memory: match.cad_memory
          ? {
              title: match.cad_memory.title,
              shape_type: match.cad_memory.shape_type,
              quality_score: match.cad_memory.quality_score,
              usage_count: match.cad_memory.usage_count,
              success_count: match.cad_memory.success_count,
              failure_count: match.cad_memory.failure_count,
            }
          : null,
      }))
    : [];

  return {
    generation,
    memoryMatches,
    feedbackEvents: Array.isArray(snapshot.feedbackEvents) ? snapshot.feedbackEvents.slice(0, 8) : [],
    tables,
  };
}

export async function analyzeLearningOutcome({ prompt, signal, rating, feedback, errorMessages, snapshot } = {}) {
  const userPayload = {
    prompt,
    signal,
    rating,
    feedback,
    errorMessages,
    databaseSnapshot: compactLearningSnapshot(snapshot),
  };

  try {
    const raw = await chat([
      { role: "system", content: LEARNING_OUTCOME_SYSTEM },
      { role: "user", content: JSON.stringify(userPayload).slice(0, 12000) },
    ]);
    return JSON.parse(stripJson(raw));
  } catch (err) {
    console.warn(`[AI] Learning analysis fallback used: ${err.message}`);
    return {
      summary: "The learning auditor was unavailable, so a fallback lesson was created locally.",
      whatWentWrong: errorMessages || feedback || "No issue reported",
      weightAdvice: Number(rating) >= 4 || signal === "good"
        ? "Positive feedback should slightly increase matching memory quality scores."
        : "Negative feedback should decrease matching memory quality scores and save the failure as a lesson.",
      nextPromptGuidance: "Prefer compile-safe parametric FeatureScript with editable dimensions, conservative operations, and a provider fallback when the primary LLM is unavailable.",
      memoryCandidate: {
        title: `Feedback lesson ${Date.now()}`,
        summary: normalizeText(feedback || errorMessages || prompt || "CAD generation feedback"),
        shapeType: snapshot?.generation?.shape_type || "CUSTOM",
        tags: ["feedback", signal || "learning"],
        keywords: extractPromptKeywords(prompt || "", 6),
        parameterHints: [],
        modelingNotes: ["Keep generated dimensions editable and validate FeatureScript syntax before returning code."],
        failureModes: [normalizeText(errorMessages || err.message || "Learning analysis provider unavailable").slice(0, 240)],
        validationRules: ["Use exactly one exported feature and compile-safe FeatureScript API calls."],
        qualityScore: Number(rating) >= 4 || signal === "good" ? 0.68 : 0.45,
      },
    };
  }
}

// ─── Public: Analyze images ───────────────────────────────────────────────────

export async function analyzeImage(imageBase64, mimeType, extraPrompt, options = {}) {
  return analyzeImages([{ imageBase64, mimeType, context: "Reference" }], extraPrompt, options);
}

export async function analyzeImages(images, extraPrompt, options = {}) {
  console.log(`[AI] Analyzing ${images.length} image(s)`);

  const content = [];
  images.forEach((img, i) => {
    content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.imageBase64}` } });
    content.push({ type: "text", text: `Image ${i + 1}${img.context ? ` — ${img.context}` : ""}:` });
  });
  content.push({
    type: "text",
    text: `You are a mechanical CAD engineer. Analyze these images together.
${extraPrompt ? `User instructions: "${extraPrompt}"` : ""}
Describe: part name and function, shape type, all visible dimensions in inches, holes, fillets, chamfers, material if visible, and how the images relate (e.g. drawing + 3D view). Plain text, no bullet points.`
  });

  let descRaw = "";
  try {
    descRaw = await callGroqVisionLLM([{ role: "user", content }], VISION_MODEL);
  } catch (err) {
    console.warn(`[AI] Vision analysis fallback used: ${err.message}`);
    if (!String(extraPrompt || "").trim()) {
      descRaw = "Vision analysis unavailable. Falling back to a conservative placeholder interpretation of the uploaded reference images.";
    } else {
      descRaw = `Vision analysis unavailable. Using the user's text prompt only. Reason: ${err.message}`;
    }
  }

  // Cap the description so the downstream generateFeatureScript calls stay within TPM limits.
  // Vision descriptions can be very long; 600 chars is plenty for dimension extraction.
  const descForGen = descRaw.length > 600 ? descRaw.slice(0, 600) + "…" : descRaw;
  const combinedPrompt = extraPrompt ? `${extraPrompt}. From images: ${descForGen}` : descForGen;

  const generated = await generateFeatureScript(combinedPrompt, options);
  return { description: descRaw, ...generated };
}
