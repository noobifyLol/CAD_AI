import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOG_DIR = join(ROOT, "logs");
const OUTPUT_PATH = join(ROOT, "data", "failureCorpus.jsonl");

const SEED_ENTRIES = [
  ["Create me a spur gear with a gear ratio of 2:1", ["User modifications were not reflected in the generated gear geometry.", "Custom isInteger bounds should be typed as IntegerBoundSpec."]],
  ["Create me a realistic carrot", ["Generated FeatureScript ended unfinished.", "Organic revolve path used invalid sketch/revolve syntax."]],
  ["Create me a L bracket", ["Generated invalid initializer arguments.", "Used invalid variables and unsupported query/operation patterns."]],
  ["Create me a mushroom", ["Generation was blocked by missing skSolve and downstream op ordering."]],
  ["Create me headphones", ["Generated invalid initializer arguments.", "Used unstable revolve/sweep construction."]],
  ["Make a simple wheel shape for 3D printing. No spokes, just a solid disc with rounded edges", ["Generated file ended unfinished.", "Used unsupported query helpers and bad opExtrude/opCut patterns."]],
  ["Generate me a pen", ["Generated invalid initializer arguments.", "Used invalid revolve axis and unsupported feature parameters."]],
  ["Create me a nightLamp", ["Generated file was cut off.", "Used invalid plane/body helpers and unfinished boolean sequence."]],
  ["Create me a pillow", ["Used unsupported helper ops like opBore/opPlateHoles/opExtrudeBlind.", "Generated invalid initializer arguments."]],
  ["Make a simple robot head that can be 3D printed. Use basic shapes, rounded edges, and avoid overhangs", ["Generation collapsed into unstable fillet/query behavior.", "Result should simplify rather than block."]],
  ["Create a low-poly dinosaur model that is fully manifold and 3D-printable.", ["Generation failed due to missing precondition and insufficient decomposition.", "Should return simplified editable geometry instead of an empty response."]],
  ["Generate me chromebook", ["Prompt lacked dimensional grounding and realistic component decomposition.", "Should return a simplified editable shell rather than a block response."]],
];

function toEntry(prompt, notes = []) {
  return {
    prompt,
    timestamp: new Date().toISOString(),
    generationMode: "historical_failure",
    completionLevel: "partial",
    rawCode: "",
    sanitizedCode: "",
    validatorIssues: [],
    fatalIssues: [],
    compileErrors: notes,
    userResult: "needs_work",
    fixedCode: "",
    notes: notes.join(" | "),
  };
}

function loadLogEntries() {
  if (!existsSync(LOG_DIR)) return [];
  const newestLog = ["generations_20260516020123.json", "generations_20260516020056.json", "generations_20260516011105.json"]
    .map(name => join(LOG_DIR, name))
    .find(path => existsSync(path));
  if (!newestLog) return [];

  try {
    const parsed = JSON.parse(readFileSync(newestLog, "utf8"));
    const results = Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
    return results
      .filter(item => item?.prompt)
      .map(item => ({
        prompt: String(item.prompt),
        timestamp: parsed.createdAt || new Date().toISOString(),
        generationMode: item?.generation?.generationMode || "historical_log",
        completionLevel: item?.generation?.completionLevel || "partial",
        rawCode: item?.generation?.code || "",
        sanitizedCode: item?.debug?.json?.fixed || item?.generation?.code || "",
        validatorIssues: item?.validationIssues || [],
        fatalIssues: item?.fatalIssues || [],
        compileErrors: (item?.validationIssues || []).map(issue => issue.message).slice(0, 8),
        userResult: item?.compileProxyOk ? "compiled" : "needs_work",
        fixedCode: item?.debug?.json?.fixed || "",
        notes: item?.compileProxyOk ? "Imported from historical smoke test log." : "Historical smoke test failure imported for regression tracking.",
      }));
  } catch {
    return [];
  }
}

function main() {
  const entries = [
    ...SEED_ENTRIES.map(([prompt, notes]) => toEntry(prompt, notes)),
    ...loadLogEntries(),
  ];

  const deduped = new Map();
  for (const entry of entries) {
    deduped.set(entry.prompt, entry);
  }

  const jsonl = [...deduped.values()]
    .map(entry => JSON.stringify(entry))
    .join("\n");
  writeFileSync(OUTPUT_PATH, `${jsonl}\n`);
  console.log(`Wrote ${deduped.size} failure corpus entries to ${OUTPUT_PATH}`);
}

main();
