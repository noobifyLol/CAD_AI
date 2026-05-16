import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function runTarList(path) {
  if (!existsSync(path)) return [];
  const result = spawnSync("tar", ["-tf", path], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function summarizeDeepCadJson(entries) {
  const jsonCount = entries.filter(name => name.endsWith(".json")).length;
  const buckets = new Set(entries.map(name => name.split("/")[1]).filter(Boolean));
  return {
    jsonCount,
    bucketCount: buckets.size,
    summary: `DeepCAD-style archive exposes ${jsonCount} JSON construction-sequence files across ${buckets.size} buckets.`,
  };
}

function writeRows(outputPath, rows) {
  const headers = [
    "title", "summary", "tags", "keywords", "parameter_hints", "modeling_notes",
    "feature_pattern", "failure_modes", "validation_rules", "example_prompt",
    "shape_type", "memory_type", "quality_score", "source_table", "memory_only",
  ];
  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(",")),
  ].join("\n");
  writeFileSync(outputPath, `${csv}\n`);
}

const cadJsonPath = resolve("data/data/cad_json.tar.gz");
const cadVecPath = resolve("data/data/cad_vec.tar.gz");
const outputPath = resolve(process.argv[2] || "data/cadMemoryExamples.dataset.csv");
const cadJson = summarizeDeepCadJson(runTarList(cadJsonPath));
const cadVec = runTarList(cadVecPath);

writeRows(outputPath, [
  {
    title: "DeepCAD Construction Sequence Corpus",
    summary: cadJson.summary,
    tags: "deepcad;dataset;construction-sequence;extrude;sketch",
    keywords: "deepcad;json;sequence;sketch;extrude;profile;command",
    parameter_hints: "profile curves;extrude distance;bounding box;operation sequence",
    modeling_notes: "Use JSON entities as retrieval snippets; convert Sketch entities to solved FeatureScript sketches; convert ExtrudeFeature distance extents to opExtrude calls.",
    feature_pattern: "DeepCAD JSON: Sketch profiles + ordered ExtrudeFeature sequence -> FeatureScript sketch + skSolve + opExtrude.",
    failure_modes: "unit mismatch;profile loops not classified;extrude operation sign reversed",
    validation_rules: "sketch profile must be closed;extrude distance must be positive after unit conversion;sequence order must be preserved",
    example_prompt: "Generate a spacer from a DeepCAD sketch/extrude command sequence",
    shape_type: "CUSTOM",
    memory_type: "example",
    quality_score: "0.82",
    source_table: "cad_memory",
    memory_only: "true",
  },
  {
    title: "CAD-MLLM Vector Command Corpus",
    summary: `CAD vector archive exposes ${cadVec.filter(name => name.endsWith(".h5")).length} vector command files for multimodal conditioning and reranking.`,
    tags: "cad-mllm;vector;command-sequence;multimodal",
    keywords: "cad-mllm;h5;vector;command sequence;point cloud;image conditioning",
    parameter_hints: "command token;profile token;extrude token;view embedding",
    modeling_notes: "Use vector records as retrieval anchors, not direct FeatureScript; pair captions and profile descriptors with validated templates.",
    feature_pattern: "Vector command example -> retrieve caption/profile descriptors -> choose revolve/loft/sweep/extrude template.",
    failure_modes: "opaque h5 tokens cannot be emitted as FeatureScript;caption overfits visual detail;lost parameter editability",
    validation_rules: "always map vector examples to editable precondition parameters;never paste raw token sequences into FS",
    example_prompt: "Use a CAD-MLLM vector example to condition an editable Onshape feature",
    shape_type: "CUSTOM",
    memory_type: "example",
    quality_score: "0.8",
    source_table: "cad_memory",
    memory_only: "true",
  },
]);

console.log(JSON.stringify({
  outputPath,
  cadJson,
  cadVecFiles: cadVec.filter(name => name.endsWith(".h5")).length,
}, null, 2));
