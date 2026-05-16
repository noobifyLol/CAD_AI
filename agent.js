import express from "express";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAD_MLLM_EXECUTE_PROMPT_TEMPLATE,
  CAD_MLLM_PLAN_PROMPT_TEMPLATE,
  debugFeatureScript,
  generateFeatureScript,
  validateFeatureScript,
} from "./ai.js";
import { candidateFeatureVector } from "./adaptiveNetwork.js";
import { extractMultimodalConditioning } from "./multimodalConditioning.js";

const DATA_DIR = new URL("./data/", import.meta.url);
const FS_EXAMPLE_DIR = new URL("./data/fs_examples/", import.meta.url);
const LOG_DIR = new URL("./logs/", import.meta.url);
const RAW_GENERATION_DIR = new URL("./logs/raw_generations/", import.meta.url);
const FS_EXAMPLE_PATH = fileURLToPath(FS_EXAMPLE_DIR);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function keywordList(text, limit = 12) {
  const stop = new Set(["the", "and", "with", "for", "from", "into", "using", "create", "make", "part", "inch", "inches", "featurescript"]);
  return [...new Set((normalizeText(text).toLowerCase().match(/[a-z0-9_]+/g) || [])
    .filter(word => word.length > 2 && !stop.has(word)))]
    .slice(0, limit);
}

function operationFromPrompt(prompt) {
  const text = normalizeText(prompt).toLowerCase();
  const operations = [];
  if (/\b(carrot|organic|revolve|axis|lathe|vase|bottle|radial|silhouette)\b/.test(text)) operations.push("revolve");
  if (/\b(loft|transition|airfoil|vase|bottle|circle to|square to|profile)\b/.test(text)) operations.push("loft");
  if (/\b(sweep|pipe|tube|elbow|hose|path|arc)\b/.test(text)) operations.push("sweep");
  if (/\b(shell|enclosure|housing|case|open top|wall thickness)\b/.test(text)) operations.push("shell");
  if (/\b(flange|bolt|hole pattern|circular pattern|mounting)\b/.test(text)) operations.push("pattern");
  if (/\b(fillet|round|chamfer|bevel)\b/.test(text)) operations.push("fillet");
  if (!operations.length) operations.push("extrude");
  return [...new Set(operations)];
}

function fallbackForOperations(operations) {
  if (operations.includes("pattern") && operations.includes("revolve")) return "hybrid_organic_flange.fs";
  if (operations.includes("sweep")) return "sweep_pipe_elbow.fs";
  if (operations.includes("loft")) return "loft_transition_square_to_circle.fs";
  if (operations.includes("shell")) return "shell_enclosure_open_top.fs";
  if (operations.includes("revolve")) return "revolve_carrot.fs";
  if (operations.includes("fillet")) return "fillet_and_chamfer_example.fs";
  return "loft_transition_square_to_circle.fs";
}

function buildPlan(prompt, multimodal) {
  const operations = operationFromPrompt(prompt);
  const keywords = keywordList(`${prompt} ${multimodal.summary || ""}`, 16);
  const subtasks = operations.map((operation, index) => ({
    id: `step_${index + 1}_${operation}`,
    operation,
    goal: {
      revolve: "build an axisymmetric body from a closed silhouette profile",
      loft: "transition between solved profile sketches on ordered offset planes",
      sweep: "sweep a circular or custom profile along a connected wire path",
      shell: "hollow a valid solid body after the base extrude exists",
      pattern: "add repeated mechanical features such as bolt holes or flange cuts",
      fillet: "apply edge finishing after the primary solid is stable",
      extrude: "create a stable prism from one solved sketch",
    }[operation] || "create the requested feature",
    retrievalKeywords: [...new Set([operation, ...keywords])].slice(0, 10),
    validationFocus: {
      revolve: ["closed profile", "axis is Line", "profile x >= 0", "skSolve before opRevolve"],
      loft: ["profile topology similarity", "profileSubqueries", "ordered planes", "skSolve for every profile"],
      sweep: ["connected path", "profile plane perpendicular to tangent", "skSolve before opSweep"],
      shell: ["wall thickness less than half minimum span", "opShell after solid body"],
      pattern: ["bolt holes stay inside flange", "boolean tools and targets are separate"],
      fillet: ["fillet/chamfer after solid body", "radius smaller than local edge span"],
      extrude: ["closed sketch", "qSketchRegion uses sketch id", "editable dimensions"],
    }[operation] || ["editable dimensions", "compile-safe FeatureScript"],
  }));

  return {
    loop: ["Plan", "Decompose", "Retrieve", "Generate", "Validate", "Repair", "Finalize", "Learn"],
    shapeClass: operations.includes("revolve") ? "organic_or_axisymmetric" : operations[0],
    operations,
    parameters: inferParameterNames(prompt, operations),
    multimodalSummary: multimodal.summary || "none",
    subtasks,
    fallbackTemplate: fallbackForOperations(operations),
  };
}

function inferParameterNames(prompt, operations) {
  const text = normalizeText(prompt).toLowerCase();
  const names = new Set();
  if (operations.includes("revolve")) ["baseRadius", "height", "tipRadius", "curvatureFactor"].forEach(name => names.add(name));
  if (operations.includes("loft")) ["height", "squareSize", "circleRadius", "profileOffset"].forEach(name => names.add(name));
  if (operations.includes("sweep")) ["outerRadius", "bendRadius"].forEach(name => names.add(name));
  if (operations.includes("shell")) ["width", "depth", "height", "wallThickness", "openTop"].forEach(name => names.add(name));
  if (operations.includes("pattern") || /\bbolt|flange\b/.test(text)) ["flangeRadius", "boltRadius", "boltCircleRadius"].forEach(name => names.add(name));
  return [...names].map(name => ({ name, source: "prompt_or_pattern_hint" }));
}

async function retrieveFeatureScriptSnippets(prompt, plan, limit = 4) {
  if (!existsSync(FS_EXAMPLE_DIR)) return [];
  const files = (await readdir(FS_EXAMPLE_DIR)).filter(file => file.endsWith(".fs"));
  const keywords = new Set(keywordList(`${prompt} ${plan.operations.join(" ")}`, 20));
  const scored = [];
  for (const file of files) {
    const fullPath = join(FS_EXAMPLE_PATH, file);
    const code = await readFile(fullPath, "utf8");
    const haystack = `${file} ${code}`.toLowerCase();
    const score = [...keywords].reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
    scored.push({
      title: `FeatureScript example: ${file}`,
      file,
      code,
      score: score + (file === plan.fallbackTemplate ? 5 : 0),
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippetMemoryRows(snippets) {
  return snippets.map(snippet => ({
    memory_type: "fs_example",
    title: snippet.title,
    summary: `Validated local FeatureScript example from ${snippet.file}.`,
    shape_type: "CUSTOM",
    tags: ["featurescript", "example", basename(snippet.file, ".fs")],
    keywords: keywordList(`${snippet.file} ${snippet.code}`, 12),
    parameter_hints: [],
    modeling_notes: [`Use this as a syntax reference when the prompt needs ${basename(snippet.file, ".fs")}.`],
    feature_pattern: snippet.code.slice(0, 5000),
    failure_modes: [],
    validation_rules: ["Starts with FeatureScript 2931", "Imports geometry.fs 2931.0", "Uses skSolve before downstream operations"],
    quality_score: 0.92,
    _score: snippet.score,
    _combinedScore: snippet.score / 10,
  }));
}

function buildExecutionPrompt(prompt, plan, multimodal, snippets) {
  const snippetList = snippets.map(s => `- ${s.file}: ${s.code.slice(0, 900)}`).join("\n");
  return [
    CAD_MLLM_PLAN_PROMPT_TEMPLATE,
    CAD_MLLM_EXECUTE_PROMPT_TEMPLATE,
    `USER PROMPT: ${prompt}`,
    `PLAN: ${JSON.stringify(plan)}`,
    multimodal.hasMultimodalInput ? `MULTIMODAL FEATURES: ${JSON.stringify(multimodal).slice(0, 3000)}` : "MULTIMODAL FEATURES: none",
    snippetList ? `LOCAL FS SNIPPETS:\n${snippetList}` : "LOCAL FS SNIPPETS: none",
    "Return one complete compile-safe FeatureScript file.",
  ].join("\n\n");
}

function aiGenerationConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

function validateAgentFeatureScript(code, plan) {
  const issues = [...validateFeatureScript(code)];
  const text = String(code || "");
  const add = (message, line = 0, snippet = "") => issues.push({ line, message, text: snippet });

  if (!/^FeatureScript\s+2931\s*;/m.test(text)) add("File must start with FeatureScript 2931.");
  if (!/import\s*\(\s*path\s*:\s*"onshape\/std\/geometry\.fs"\s*,\s*version\s*:\s*"2931\.0"\s*\)/.test(text)) {
    add("Missing geometry.fs 2931.0 import.");
  }
  const exportCount = (text.match(/\bexport\s+const\b/g) || []).length;
  if (exportCount !== 1) add(`Expected exactly one exported feature, found ${exportCount}.`);

  for (const operation of plan.operations || []) {
    if (operation === "revolve" && /\bopRevolve\s*\(/.test(text) && !/"axis"\s*:\s*line\s*\(|var\s+\w*Axis\w*\s*=\s*line\s*\(/.test(text)) {
      add("opRevolve axis must be a Line value.");
    }
    if (operation === "loft" && /\bopLoft\s*\(/.test(text) && !/"profileSubqueries"\s*:/.test(text)) {
      add("opLoft must use profileSubqueries from solved profile sketches.");
    }
    if (operation === "sweep" && /\bopSweep\s*\(/.test(text) && !/"path"\s*:/.test(text)) {
      add("opSweep must include a connected path query.");
    }
    const shellCallIndex = text.search(/\bopShell\s*\(/);
    if (operation === "shell" && shellCallIndex >= 0 && shellCallIndex < text.search(/\bopExtrude\s*\(|\bopRevolve\s*\(/)) {
      add("opShell must run after a solid body operation.");
    }
  }

  const firstDownstream = text.search(/\bop(Extrude|Revolve|Loft|Sweep)\s*\(/);
  const firstSolve = text.search(/\bskSolve\s*\(/);
  if (firstDownstream >= 0 && (firstSolve < 0 || firstSolve > firstDownstream)) {
    add("skSolve must appear before the first downstream solid operation.");
  }
  if (/"(edges|sections|vertices)"\s*:/.test(text) && /\bopLoft\s*\(/.test(text)) {
    add("Replace old opLoft edges/sections/vertices keys with profileSubqueries.");
  }

  return issues;
}

async function readFallbackTemplate(plan) {
  const file = plan.fallbackTemplate || "loft_transition_square_to_circle.fs";
  const fullPath = join(FS_EXAMPLE_PATH, file);
  if (existsSync(fullPath)) {
    return {
      code: await readFile(fullPath, "utf8"),
      file,
    };
  }
  return { code: "", file: null };
}

function traceRows(rows = []) {
  return rows.slice(0, 12).map(row => ({
    title: row.title,
    memory_type: row.memory_type || row.memoryType || null,
    source_table: row.source_table || row.sourceTable || null,
    quality_score: row.quality_score ?? row.qualityScore ?? null,
    score: Number(row._combinedScore ?? row._score ?? 0),
    keywords: row.keywords || [],
  }));
}

async function appendTrainingRows({ prompt, learningContext, plan, target, source }) {
  const rows = [];
  const rankContext = {
    prompt,
    keywords: learningContext.keywords || keywordList(prompt),
    shapeHint: learningContext.shapeHint || null,
  };
  const candidates = [
    ...(learningContext.knowledge || []),
    ...(learningContext.featureScriptDocs || []),
  ].slice(0, 20);
  for (const candidate of candidates) {
    const vector = Array.isArray(candidate._featureVector) && candidate._featureVector.length
      ? candidate._featureVector
      : candidateFeatureVector(candidate, rankContext, candidate._sourceKind || candidate.memory_type || "agent");
    rows.push(JSON.stringify({
      vector,
      target,
      source,
      prompt,
      operations: plan.operations,
      timestamp: new Date().toISOString(),
    }));
  }
  if (!rows.length) return 0;
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(new URL("./data/adaptive_training.jsonl", import.meta.url), `${rows.join("\n")}\n`);
  return rows.length;
}

async function writeJsonLog(prefix, payload) {
  await mkdir(LOG_DIR, { recursive: true });
  const file = new URL(`./logs/${prefix}_${timestamp()}.json`, import.meta.url);
  await writeFile(file, JSON.stringify(payload, null, 2));
  return file.pathname;
}

async function writeRawGeneration(prompt, code) {
  await mkdir(RAW_GENERATION_DIR, { recursive: true });
  const safe = normalizeText(prompt).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 48) || "generation";
  const file = new URL(`./logs/raw_generations/${timestamp()}_${safe}.fs`, import.meta.url);
  await writeFile(file, code || "");
  return file.pathname;
}

export function createCadMllmAgentRouter({ learning }) {
  const router = express.Router();

  router.post("/run", async (req, res) => {
    const prompt = normalizeText(req.body.prompt);
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const maxRepairAttempts = Math.max(0, Math.min(3, Number(req.body.maxRepairAttempts ?? 1)));
    if (!prompt) return res.status(400).json({ error: "No prompt provided." });

    try {
      const multimodal = extractMultimodalConditioning(req.body);
      const plan = buildPlan(prompt, multimodal);
      const snippets = await retrieveFeatureScriptSnippets(prompt, plan);
      const retrievalPrompt = [prompt, plan.operations.join(" "), multimodal.summary].filter(Boolean).join(" | ");
      const preferTemplate = req.body.preferTemplate === true;
      const forceAi = req.body.forceAi === true;
      const aiAvailable = aiGenerationConfigured();
      const strategyRequested = forceAi ? "force_ai" : preferTemplate ? "prefer_template" : "ai_then_fallback";
      const learningContext = await learning.fetchLearningContext(retrievalPrompt, history);
      learningContext.notes = [
        ...(learningContext.notes || []),
        `CAD-MLLM loop: ${plan.loop.join(" -> ")}.`,
        `CAD-MLLM subtasks: ${plan.subtasks.map(s => `${s.operation}:${s.goal}`).join("; ")}.`,
        multimodal.summary ? `Multimodal conditioning: ${multimodal.summary}.` : "Multimodal conditioning: none supplied.",
      ];
      learningContext.knowledge = [
        ...snippetMemoryRows(snippets),
        ...(learningContext.knowledge || []),
      ];

      const executionPrompt = buildExecutionPrompt(prompt, plan, multimodal, snippets);
      let generated = null;
      let initialTemplateFile = null;
      let generationError = null;

      if (forceAi && !aiAvailable) {
        throw new Error("forceAi was requested, but GROQ_API_KEY is not configured for CAD generation.");
      }

      if (!preferTemplate && aiAvailable) {
        try {
          generated = await generateFeatureScript(executionPrompt, { learningContext, history });
        } catch (err) {
          generationError = err;
        }
      }

      if (!generated) {
        const template = await readFallbackTemplate(plan);
        if (template.code) {
          initialTemplateFile = template.file;
          generated = {
            code: template.code,
            featureName: basename(template.file || "cadMllmTemplate", ".fs"),
            featureLabel: `CAD-MLLM Template ${basename(template.file || "template", ".fs")}`,
            thinking: generationError
              ? `CAD-MLLM generation fell back to a validated local FeatureScript template after an AI generation error: ${generationError.message}`
              : preferTemplate
                ? "CAD-MLLM agent used a validated local FeatureScript template because preferTemplate was requested."
                : "CAD-MLLM agent used a validated local FeatureScript template because AI generation is unavailable.",
            dims: {},
            generationMode: "agent_template",
          };
        }
      }

      if (!generated && generationError) {
        throw generationError;
      }
      await writeRawGeneration(prompt, generated.code);

      let code = generated.code;
      let validationIssues = validateAgentFeatureScript(code, plan);
      const repairs = [];

      for (let attempt = 0; attempt < maxRepairAttempts && validationIssues.length; attempt += 1) {
        const errorText = validationIssues
          .slice(0, 14)
          .map(issue => `Line ${issue.line || "?"}: ${issue.message} ${issue.text || ""}`.trim())
          .join("\n");
        const repaired = await debugFeatureScript(code, errorText, { learningContext });
        code = repaired.fixed;
        repairs.push({ attempt: attempt + 1, explanation: repaired.explanation, beforeIssues: validationIssues.length });
        validationIssues = validateAgentFeatureScript(code, plan);
      }

      let fallbackTemplate = false;
      let fallbackFile = null;
      if (validationIssues.length) {
        const fallback = await readFallbackTemplate(plan);
        if (fallback.code) {
          code = fallback.code;
          fallbackTemplate = true;
          fallbackFile = fallback.file;
          validationIssues = validateAgentFeatureScript(code, plan);
        }
      }

      const result = {
        ...generated,
        code,
        thinking: [
          generated.thinking || "",
          `CAD-MLLM plan operations: ${plan.operations.join(", ")}`,
          repairs.length ? `Repair attempts: ${repairs.length}` : "Repair attempts: 0",
          fallbackTemplate ? `Fallback template used: ${fallbackFile}` : "Fallback template used: false",
        ].filter(Boolean).join("\n"),
        generationMode: fallbackTemplate ? "agent_fallback_template" : "agent_cad_mllm",
      };
      const generationLog = await learning.logGeneration(prompt, result, {
        learningContext,
        userId: req.user?.id || null,
      });

      const trace = {
        prompt,
        plan,
        multimodal,
        generationStrategy: {
          requested: strategyRequested,
          aiAvailable,
          used: fallbackTemplate
            ? "validated_fallback_template"
            : generated.generationMode || (initialTemplateFile ? "template" : "ai"),
          preferTemplate,
          forceAi,
          initialTemplateFile,
          generationError: generationError?.message || null,
        },
        retrieval: {
          keywords: learningContext.keywords || [],
          knowledgeRows: traceRows(learningContext.knowledge || []),
          pruningRows: traceRows((learningContext.knowledge || []).filter(row => String(row.memory_type || row.memoryType || "").includes("pruning"))),
          featureScriptSnippets: snippets.map(snippet => ({ file: snippet.file, score: snippet.score })),
          memoryMatches: learningContext.memoryMatches || [],
        },
        validation: {
          passed: validationIssues.length === 0,
          issues: validationIssues,
          repairs,
          fallbackTemplate,
          fallbackFile,
        },
        generationId: generationLog?.id || null,
      };
      const tracePath = await writeJsonLog("agent_trace", trace);
      const trainingRows = await appendTrainingRows({
        prompt,
        learningContext,
        plan,
        target: validationIssues.length === 0 ? 1 : 0,
        source: fallbackTemplate ? "agent_fallback" : "agent_generation",
      });

      res.json({
        code,
        reasoningTrace: trace,
        tracePath,
        trainingRows,
        generationId: generationLog?.id || null,
        fallback_template: fallbackTemplate,
      });
    } catch (err) {
      console.error("[/agent/run]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export const createAgentRouter = createCadMllmAgentRouter;
export { buildPlan, validateAgentFeatureScript };
