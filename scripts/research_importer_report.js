import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const logs = join(root, "logs");
const timestamp = Math.floor(Date.now() / 1000);

const testPrompts = [
  "Create an organic carrot using a 5-point spline at 0%,20%,45%,70%,100% heights. Expose baseRadius, height, curvatureFactor, tipRadius. Use axis line at x=0, skSolve, opRevolve 360°. Return only compile-safe FeatureScript.",
  "Create a transition from 2 inch square to 1 inch circle over 3 inches using opLoft. Expose height and profile offsets.",
  "Create a 90-degree elbow pipe with 0.5 inch outer radius and 2 inch bend radius using opSweep.",
  "Create an open-top electronics enclosure 4x3x1.5 inches with 0.1 inch walls using opShell after extrude. Expose wallThickness and openFace boolean.",
  "Create a carrot-like body with a mounting flange: revolve organic profile for body, add flange ring with 4 bolt holes in circular pattern.",
  "Attempt to loft a circle to a rectangle; if profiles are too dissimilar, apply pruning rule to insert intermediate profile or fallback to multi-profile loft.",
];

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || err.message,
      code: err.status || 1,
    };
  }
}

async function ensureServer() {
  try {
    const res = await fetch("http://localhost:10000/health");
    if (res.ok) return { started: false, ok: true };
  } catch {
    // Start below.
  }
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 750));
    try {
      const res = await fetch("http://localhost:10000/health");
      if (res.ok) return { started: true, ok: true, pid: child.pid };
    } catch {
      // Retry.
    }
  }
  return { started: true, ok: false, pid: child.pid };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function countCsvRows(path) {
  if (!existsSync(path)) return 0;
  return Math.max(0, (execFileSync(process.execPath, ["-e", `
const fs=require('fs');
const text=fs.readFileSync(process.argv[1],'utf8').trim();
let rows=0, q=false;
for (let i=0;i<text.length;i++) { const ch=text[i], nx=text[i+1]; if (q && ch=='"' && nx=='"') { i++; continue; } if (ch=='"') q=!q; if (!q && ch=='\\n') rows++; }
console.log(Math.max(0, rows));
`, path], { encoding: "utf8" }).trim() | 0));
}

async function main() {
  await mkdir(logs, { recursive: true });

  const build = run(process.execPath, ["scripts/build_research_import_artifacts.js"]);
  const imports = [
    run(process.execPath, ["scripts/importCadKnowledgeCsv.js", "./data/cadKnowledge.new.csv"]),
    run(process.execPath, ["scripts/importCadKnowledgeCsv.js", "./data/cadPruningTable.new.csv"]),
    run(process.execPath, ["scripts/importCadKnowledgeCsv.js", "./data/cadMemoryExamples.new.csv"]),
    run(process.execPath, ["scripts/seedCadKnowledge.js"]),
  ];
  const train = run(process.execPath, ["scripts/train_adaptive_network.js", "data/adaptive_training.jsonl"]);
  const diagnostics = run(process.execPath, ["scripts/dbLearningReport.js"]);
  const diagnosticsPath = join(logs, `learning_diagnostics_${timestamp}.txt`);
  await writeFile(diagnosticsPath, `${diagnostics.stdout}${diagnostics.stderr || ""}`);

  const server = await ensureServer();
  const generations = [];
  if (server.ok) {
    for (const prompt of testPrompts) {
      try {
        generations.push(await postJson("http://localhost:10000/generate", { prompt, history: [] }));
      } catch (err) {
        generations.push({ ok: false, error: err.message, prompt });
      }
    }
  }
  const generationsPath = join(logs, `generations_${timestamp}.json`);
  await writeFile(generationsPath, JSON.stringify(generations, null, 2));

  const successes = generations.filter(item => item.ok && item.json?.reasoningTrace?.validation?.passed).length;
  const attempted = generations.length;
  const compileSuccessRate = attempted ? successes / attempted : null;
  let metrics = {};
  const metricsPath = join(logs, "metrics.json");
  if (existsSync(metricsPath)) {
    try {
      metrics = JSON.parse(await readFile(metricsPath, "utf8"));
    } catch {
      metrics = {};
    }
  }
  metrics.compile_success_rate = compileSuccessRate;
  metrics.pruning_rule_trigger_rate = attempted
    ? generations.filter(item => (item.json?.reasoningTrace?.retrieval?.pruningRows || []).length > 0).length / attempted
    : null;
  metrics.adaptive_network_trained_steps = (() => {
    try {
      const parsed = JSON.parse(train.stdout);
      return parsed.trainedSteps || null;
    } catch {
      return null;
    }
  })();
  metrics.generated_at = new Date().toISOString();
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(join(root, "public", "learning_dashboard.json"), JSON.stringify(metrics, null, 2));

  const fsFiles = existsSync(join(root, "data", "fs_examples"))
    ? execFileSync(process.platform === "win32" ? "powershell" : "sh", process.platform === "win32"
      ? ["-NoProfile", "-Command", "Get-ChildItem data/fs_examples -Filter *.fs | ForEach-Object { $_.Name }"]
      : ["-lc", "ls data/fs_examples/*.fs 2>/dev/null | xargs -n1 basename"], { cwd: root, encoding: "utf8" })
        .split(/\r?\n/).filter(Boolean)
    : [];

  const summary = [
    "# Research Import Summary",
    "",
    `Timestamp: ${new Date(timestamp * 1000).toISOString()}`,
    "",
    `- Knowledge rows added: ${countCsvRows(join(root, "data", "cadKnowledge.new.csv"))}`,
    `- Pruning rules added: ${countCsvRows(join(root, "data", "cadPruningTable.new.csv"))}`,
    `- Memory/example rows ready: ${countCsvRows(join(root, "data", "cadMemoryExamples.new.csv"))}`,
    `- FeatureScript examples created: ${fsFiles.length}`,
    `- FeatureScript filenames: ${fsFiles.join(", ")}`,
    `- Diagnostics log: ${diagnosticsPath}`,
    `- Generations log: ${generationsPath}`,
    `- Static compile success rate: ${compileSuccessRate === null ? "not run" : `${Math.round(compileSuccessRate * 100)}%`}`,
    `- Server started by script: ${Boolean(server.started)}`,
    "",
    "## Command Results",
    "",
    `- Artifact build: ${build.ok ? "ok" : "failed"}`,
    `- Imports: ${imports.map(item => item.ok ? "ok" : "failed").join(", ")}`,
    `- Adaptive training: ${train.ok ? "ok" : "failed"}`,
    `- Diagnostics: ${diagnostics.ok ? "ok" : "failed"}`,
    "",
    "## Next Recommended Actions",
    "",
    "- Paste the FS examples into Onshape and mark any compile errors as feedback.",
    "- Add 20 more organic and lofted examples once real compile results are available.",
    "- Deploy the `/generate` route after Supabase schema is confirmed ready.",
    "",
  ].join("\n");

  const summaryPath = join(logs, `import_summary_${timestamp}.md`);
  await writeFile(summaryPath, summary);
  await writeFile(join(logs, "cad_mllm_import_summary.md"), summary);
  console.log(summary);
}

main().catch(err => {
  console.error(`[research_importer_report] ${err.message}`);
  process.exit(1);
});
