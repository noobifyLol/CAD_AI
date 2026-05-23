import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasFatalFeatureScriptPatterns, validateFeatureScript } from "../ai.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOG_DIR = join(ROOT, "logs");
const RAW_DIR = join(LOG_DIR, "raw_generations");
const BASE_URL = process.env.CAD_AI_BASE_URL || "http://localhost:10000";
const ENDPOINT = process.argv[2] || process.env.CAD_SMOKE_ENDPOINT || "/generate";

const DEFAULT_PROMPTS = [
  "Create me a spur gear with a gear ratio of 2:1.",
  "Create me a rectangular prism with the letter E imprinted on it.",
  "Create me a nightlamp.",
  "Create me airpods that I can 3d print.",
  "Create me a realistic carrot.",
  "Create me a spiral notebook.",
  "Create me a computer monitor.",
  "Create me a school No2 pencil.",
  "Create me a cup that can hold liquid.",
  "Create me an L-bracket.",
];
const FAILURE_CORPUS_PATH = join(ROOT, "data", "failureCorpus.jsonl");

function loadPrompts() {
  if (process.env.CAD_SMOKE_PROMPTS_JSON) {
    try {
      const prompts = JSON.parse(process.env.CAD_SMOKE_PROMPTS_JSON);
      if (Array.isArray(prompts)) return prompts.map(prompt => String(prompt || "").trim()).filter(Boolean);
    } catch {
      // Fall back to the normal prompt set below.
    }
  }
  if (process.env.CAD_SMOKE_PROMPTS) {
    return process.env.CAD_SMOKE_PROMPTS
      .split(/\s*\|\|\s*/)
      .map(prompt => prompt.trim())
      .filter(Boolean);
  }
  if (String(process.env.CAD_SMOKE_ONLY_DEFAULT || "false").toLowerCase() === "true") return DEFAULT_PROMPTS;
  if (!existsSync(FAILURE_CORPUS_PATH)) return DEFAULT_PROMPTS;
  try {
    const lines = readFileSync(FAILURE_CORPUS_PATH, "utf8")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const corpusPrompts = lines
      .map(line => JSON.parse(line))
      .map(entry => String(entry.prompt || "").trim())
      .filter(Boolean);
    return [...new Set([...DEFAULT_PROMPTS, ...corpusPrompts])];
  } catch {
    return DEFAULT_PROMPTS;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

async function postJson(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, ok: response.ok, json };
}

async function main() {
  ensureDir(LOG_DIR);
  ensureDir(RAW_DIR);
  const id = stamp();
  const prompts = loadPrompts();
  const results = [];

  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error(`health returned ${health.status}`);
  } catch (err) {
    const skipped = {
      ok: false,
      skipped: true,
      reason: `Server unavailable at ${BASE_URL}: ${err.message}`,
      endpoint: ENDPOINT,
      prompts: prompts.length,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(LOG_DIR, `generations_${id}.json`), JSON.stringify(skipped, null, 2));
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    const generation = await postJson(ENDPOINT, { prompt, history: [] });
    const code = generation.json.code || generation.json.fixed || "";
    if (code) writeFileSync(join(RAW_DIR, `smoke_${id}_${index + 1}.fs`), code);
    let issues = validateFeatureScript(code);
    let fatalIssues = hasFatalFeatureScriptPatterns(code);
    let debug = null;
    if (issues.length && code) {
      debug = await postJson("/debug", {
        code,
        errors: issues.map(issue => `${issue.line || "?"}: ${issue.message}`).join("\n"),
      });
      const fixed = debug.json.fixed || "";
      if (fixed) {
        writeFileSync(join(RAW_DIR, `smoke_${id}_${index + 1}_fixed.fs`), fixed);
        issues = validateFeatureScript(fixed);
        fatalIssues = hasFatalFeatureScriptPatterns(fixed);
      }
    }
    results.push({
      prompt,
      endpoint: ENDPOINT,
      status: generation.status,
      ok: generation.ok,
      completionLevel: generation.json.completionLevel || (code ? "full" : "partial"),
      validationIssues: issues,
      fatalIssues,
      compileProxyOk: Boolean(code) && issues.length === 0 && fatalIssues.length === 0,
      generation: generation.json,
      debug,
    });
  }

  const successCount = results.filter(result => result.compileProxyOk).length;
  const payload = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    endpoint: ENDPOINT,
    prompts: prompts.length,
    compile_success_rate: successCount / prompts.length,
    results,
  };
  writeFileSync(join(LOG_DIR, `generations_${id}.json`), JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    prompts: prompts.length,
    compile_success_rate: payload.compile_success_rate,
    log: `logs/generations_${id}.json`,
  }, null, 2));
}

main().catch(err => {
  console.error(`[run_smoke_tests] ${err.message}`);
  process.exit(1);
});
