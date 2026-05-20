import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFeatureScript } from "../ai.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOG_DIR = join(ROOT, "logs");
const RAW_DIR = join(LOG_DIR, "raw_generations");
const BASE_URL = process.env.CAD_AI_BASE_URL || "http://localhost:10000";
const ENDPOINT = process.argv[2] || process.env.CAD_SMOKE_ENDPOINT || "/agent/run";

const prompts = [
  "Create an organic carrot using a 5-point spline at 0%,20%,45%,70%,100% heights. Expose baseRadius, height, curvatureFactor, tipRadius. Use axis line at x=0, skSolve, opRevolve 360°. Return only compile-safe FeatureScript.",
  "Create a transition from 2 inch square to 1 inch circle over 3 inches using opLoft. Expose height and profile offsets.",
  "Create a 90-degree elbow pipe with 0.5 inch outer radius and 2 inch bend radius using opSweep.",
  "Create an open-top electronics enclosure 4x3x1.5 inches with 0.1 inch walls using opShell after extrude. Expose wallThickness and openFace boolean.",
  "Create me a swerve module.",
  "Create a train cab.",
  "Create a 2x1 FRC tube with bearing and mounting pattern.",
  "Create a belt-driven side plate using standard pulley spacing rules.",
];

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
    const generation = await postJson(ENDPOINT, { prompt, history: [], maxRepairAttempts: 1 });
    const code = generation.json.code || generation.json.fixed || "";
    const blocked = generation.json.generationMode === "blocked_trace_only";
    if (code) writeFileSync(join(RAW_DIR, `smoke_${id}_${index + 1}.fs`), code);
    let issues = validateFeatureScript(code);
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
      }
    }
    results.push({
      prompt,
      endpoint: ENDPOINT,
      status: generation.status,
      ok: generation.ok,
      blocked,
      validationIssues: issues,
      compileProxyOk: blocked
        ? Array.isArray(generation.json.orchestration?.blockers) && generation.json.orchestration.blockers.length > 0
        : issues.length === 0,
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
