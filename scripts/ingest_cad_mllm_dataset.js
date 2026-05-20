import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function walkFiles(rootDir, limit = 120, filter = () => true) {
  if (!existsSync(rootDir)) return [];
  const files = [];
  const queue = [rootDir];

  while (queue.length && files.length < limit) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(nextPath);
      } else if (entry.isFile() && filter(nextPath)) {
        files.push(nextPath);
        if (files.length >= limit) break;
      }
    }
  }

  return files;
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function countCurveTypes(entities = {}) {
  const counts = new Map();
  for (const entity of Object.values(entities || {})) {
    if (entity?.type === "Sketch") {
      for (const profile of Object.values(entity.profiles || {})) {
        for (const loop of profile.loops || []) {
          for (const curve of loop.profile_curves || []) {
            const key = curve.type || "UnknownCurve";
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}:${count}`);
}

function summarizeDeepCadSamples(paths) {
  let sketchCount = 0;
  let extrudeCount = 0;
  let circularProfiles = 0;
  let lineProfiles = 0;
  let mixedProfiles = 0;
  const curveTypeTotals = new Map();

  for (const path of paths) {
    const data = safeReadJson(path);
    const entities = data?.entities || {};
    const curveTypes = countCurveTypes(entities);
    const sketchs = Object.values(entities).filter(entity => entity?.type === "Sketch").length;
    const extrudes = Object.values(entities).filter(entity => /Extrude/i.test(entity?.name || "")).length;
    sketchCount += sketchs;
    extrudeCount += extrudes;

    const joined = curveTypes.join(";");
    if (/Circle3D/.test(joined) && !/Line3D/.test(joined)) circularProfiles += 1;
    else if (/Line3D/.test(joined) && !/Circle3D/.test(joined)) lineProfiles += 1;
    else mixedProfiles += 1;

    for (const item of curveTypes) {
      const [type, count] = item.split(":");
      curveTypeTotals.set(type, (curveTypeTotals.get(type) || 0) + Number(count || 0));
    }
  }

  const dominantCurves = [...curveTypeTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `${type}:${count}`);

  return {
    sampleCount: paths.length,
    sketchCount,
    extrudeCount,
    circularProfiles,
    lineProfiles,
    mixedProfiles,
    dominantCurves,
  };
}

function summarizeOmniCaptions(paths) {
  const captions = [];
  for (const path of paths) {
    const data = safeReadJson(path);
    for (const entry of Array.isArray(data) ? data : []) {
      const caption = normalizeText(entry["text caption"] || "");
      if (caption) captions.push({ id: entry.id, caption });
    }
  }

  const bucket = {
    hollow: [],
    cylindrical: [],
    plateHoles: [],
    frame: [],
  };

  for (const entry of captions.slice(0, 300)) {
    const lower = entry.caption.toLowerCase();
    if (/\b(hollow|void|open space|interior)\b/.test(lower)) bucket.hollow.push(entry);
    if (/\b(cylindrical|cylinder|shaft|round)\b/.test(lower)) bucket.cylindrical.push(entry);
    if (/\b(circular cutout|holes|cutout|corners)\b/.test(lower)) bucket.plateHoles.push(entry);
    if (/\b(beam|frame|connected|interlocking|rectangular bar|handles)\b/.test(lower)) bucket.frame.push(entry);
  }

  return {
    captionCount: captions.length,
    buckets: {
      hollow: bucket.hollow.slice(0, 6),
      cylindrical: bucket.cylindrical.slice(0, 6),
      plateHoles: bucket.plateHoles.slice(0, 6),
      frame: bucket.frame.slice(0, 6),
    },
  };
}

function datasetRow({
  title,
  summary,
  tags,
  keywords,
  parameterHints,
  modelingNotes,
  featurePattern,
  failureModes,
  validationRules,
  examplePrompt,
  shapeType = "CUSTOM",
  sourceTable = "cad_memory",
  componentTags = [],
  operationTags = [],
  sampleIds = [],
}) {
  return {
    title,
    summary,
    tags: tags.join(";"),
    keywords: keywords.join(";"),
    parameter_hints: parameterHints.join(";"),
    modeling_notes: modelingNotes.join(";"),
    feature_pattern: featurePattern,
    failure_modes: failureModes.join(";"),
    validation_rules: validationRules.join(";"),
    example_prompt: examplePrompt,
    shape_type: shapeType,
    memory_type: "dataset_example",
    quality_score: "0.84",
    source_table: sourceTable,
    memory_only: "true",
    source_url: "",
    source_type: "local_dataset",
    component_tags: componentTags.join(";"),
    operation_tags: operationTags.join(";"),
    sample_ids: sampleIds.join(";"),
  };
}

function writeCsv(outputPath, rows) {
  const headers = [
    "title", "summary", "tags", "keywords", "parameter_hints", "modeling_notes",
    "feature_pattern", "failure_modes", "validation_rules", "example_prompt",
    "shape_type", "memory_type", "quality_score", "source_table", "memory_only",
    "source_url", "source_type", "component_tags", "operation_tags", "sample_ids",
  ];
  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(",")),
  ].join("\n");
  writeFileSync(outputPath, `${csv}\n`);
}

const deepCadJsonRoot = resolve("data/data/cad_json");
const omniTxtRoot = resolve("data/Omni-CAD/txt");
const csvOutputPath = resolve(process.argv[2] || "data/cadMemoryExamples.dataset.csv");
const jsonOutputPath = resolve(process.argv[3] || "data/cadDatasetSummaries.json");

const deepCadSamples = walkFiles(deepCadJsonRoot, 80, path => path.endsWith(".json"));
const omniCaptionShards = walkFiles(omniTxtRoot, 10, path => path.endsWith(".json"));

const deepCadSummary = summarizeDeepCadSamples(deepCadSamples);
const omniSummary = summarizeOmniCaptions(omniCaptionShards);

const rows = [
  datasetRow({
    title: "DeepCAD Prismatic Extrude Corpus",
    summary: `Sampled ${deepCadSummary.sampleCount} DeepCAD construction files with ${deepCadSummary.sketchCount} sketches and ${deepCadSummary.extrudeCount} extrudes; dominant curves ${deepCadSummary.dominantCurves.join(", ")}.`,
    tags: ["dataset", "deepcad", "extrude", "sketch", "prismatic"],
    keywords: ["deepcad", "extrude", "sketch", "plate", "bracket", "mount", "frame"],
    parameterHints: ["sketchCount", "extrudeCount", "dominantCurves", "sampleCount"],
    modelingNotes: [
      "Use sampled JSON metadata as retrieval guidance instead of raw archives.",
      "Prefer sketch -> skSolve -> opExtrude patterns for prismatic parts.",
      "Treat line-dominant profiles as candidates for plates, brackets, and mounts.",
    ],
    featurePattern: "DeepCAD sample metadata -> sketch profile classification -> solved sketch -> opExtrude sequence.",
    failureModes: ["raw archive prompting", "unknown source units", "non-closed loops"],
    validationRules: ["closed profile before qSketchRegion", "skSolve before opExtrude", "editable dimensions only"],
    examplePrompt: "Create a prismatic mounting plate with holes and cutouts",
    shapeType: "BOX",
    componentTags: ["plate", "bracket", "frame", "mount"],
    operationTags: ["extrude", "cut", "pattern"],
    sampleIds: deepCadSamples.slice(0, 8).map(path => path.split("\\").slice(-2).join("/")),
  }),
  datasetRow({
    title: "DeepCAD Circular Bore And Spacer Corpus",
    summary: `DeepCAD samples include ${deepCadSummary.circularProfiles} circle-dominant profiles suited for bushings, spacers, bores, and cylindrical interfaces.`,
    tags: ["dataset", "deepcad", "circular", "bore", "spacer"],
    keywords: ["deepcad", "circle3d", "bore", "spacer", "bushing", "shaft"],
    parameterHints: ["holeRadius", "outerRadius", "faceWidth"],
    modelingNotes: [
      "Map circle-dominant loops to concentric sketch circles and extrudes.",
      "Useful for shaft bores, bearing spacers, and tube-like parts.",
      "Keep bores editable in precondition instead of hardcoding diameters.",
    ],
    featurePattern: "circular loop classification -> concentric sketch circles -> skSolve -> opExtrude.",
    failureModes: ["inner radius exceeds outer radius", "bore silently omitted"],
    validationRules: ["outer radius greater than bore radius", "skSolve before opExtrude"],
    examplePrompt: "Create a tube spacer with a center bore",
    shapeType: "CYLINDER",
    componentTags: ["spacer", "bushing", "shaft", "bore"],
    operationTags: ["extrude", "cut"],
    sampleIds: deepCadSamples.slice(8, 16).map(path => path.split("\\").slice(-2).join("/")),
  }),
  datasetRow({
    title: "Omni-CAD Hollow Prism Captions",
    summary: `Omni-CAD caption samples describe hollow rectangular prisms, open spaces, and visible interiors across ${omniSummary.buckets.hollow.length} prompt-relevant examples.`,
    tags: ["dataset", "omni-cad", "hollow", "prism", "enclosure"],
    keywords: ["omni-cad", "hollow", "open space", "enclosure", "void", "cab"],
    parameterHints: ["width", "height", "depth", "wallThickness"],
    modelingNotes: [
      "Use captions as semantic guidance for hollow bodies and cab-like envelopes.",
      "Translate hollow/open-space language into extrude then shell or explicit cut strategy.",
      "Do not infer decorative fillets from captions alone.",
    ],
    featurePattern: "caption intent -> outer envelope -> shell or stable cavity cut -> optional openings.",
    failureModes: ["caption-only dimension hallucination", "shell before body creation"],
    validationRules: ["shell after body", "wall thickness must preserve cavity"],
    examplePrompt: "Create a train cab shell with openings and interior volume",
    shapeType: "BOX",
    componentTags: ["cab", "enclosure", "panel"],
    operationTags: ["extrude", "shell", "cut"],
    sampleIds: omniSummary.buckets.hollow.map(entry => entry.id),
  }),
  datasetRow({
    title: "Omni-CAD Plate Hole Pattern Captions",
    summary: `Omni-CAD caption samples include rectangular bases with central and corner circular cutouts, useful for mounting plates and bearing interfaces.`,
    tags: ["dataset", "omni-cad", "plate", "hole pattern", "mount"],
    keywords: ["omni-cad", "cutout", "corner holes", "mounting plate", "bearing block"],
    parameterHints: ["plateWidth", "plateHeight", "holeCount", "holeSpacing"],
    modelingNotes: [
      "Use as retrieval guidance for plate-and-hole layouts.",
      "Prefer one sketch with all closed loops when holes are coplanar.",
      "Keep mounting patterns source-backed when prompt implies COTS interfaces.",
    ],
    featurePattern: "rectangular base + central bore + corner holes -> skSolve -> opExtrude.",
    failureModes: ["holes outside plate", "blind fillet on all edges"],
    validationRules: ["holes remain inside profile", "stable edge filters for finishing"],
    examplePrompt: "Create a bearing mounting plate with a center bore and corner holes",
    shapeType: "PLATE_HOLES",
    componentTags: ["plate", "mount", "bearing block"],
    operationTags: ["extrude", "cut", "pattern"],
    sampleIds: omniSummary.buckets.plateHoles.map(entry => entry.id),
  }),
  datasetRow({
    title: "Omni-CAD Cylindrical Interface Captions",
    summary: `Omni-CAD caption samples repeatedly describe cylinders, hollow centers, shafts, and flange-like bases, which are useful for bores and rotary interfaces.`,
    tags: ["dataset", "omni-cad", "cylinder", "shaft", "flange"],
    keywords: ["omni-cad", "cylinder", "shaft", "flange", "hollow center", "module"],
    parameterHints: ["radius", "boreRadius", "faceWidth", "flangeRadius"],
    modelingNotes: [
      "Use captions to bias toward rotary interfaces, bores, and flange-like supports.",
      "Good retrieval hints for swerve-style shafts, bores, and wheel interfaces.",
      "Do not convert caption-only mention of a shaft into a complete assembly without source support.",
    ],
    featurePattern: "cylindrical or flange semantic hint -> explicit bore/body parameters -> stable revolve or extrude.",
    failureModes: ["single-cylinder fallback for complex assembly", "missing bore parameter exposure"],
    validationRules: ["complex prompt must not collapse to one cylinder", "all rotary interface dims exposed"],
    examplePrompt: "Create a shaft support or wheel-side cylindrical interface",
    shapeType: "CYLINDER",
    componentTags: ["shaft", "bore", "flange", "wheel interface"],
    operationTags: ["revolve", "extrude", "cut"],
    sampleIds: omniSummary.buckets.cylindrical.map(entry => entry.id),
  }),
  datasetRow({
    title: "Omni-CAD Frame And Beam Captions",
    summary: `Omni-CAD caption samples describe connected beams, handles, interlocking rectangular components, and frame-like geometry suited to structural assemblies.`,
    tags: ["dataset", "omni-cad", "frame", "beam", "assembly"],
    keywords: ["omni-cad", "frame", "beam", "interlocking", "drivetrain", "swerve"],
    parameterHints: ["componentCount", "plateThickness", "spacing", "offsets"],
    modelingNotes: [
      "Use captions as structural hints for multi-body frame-like assemblies.",
      "Good retrieval support for drivetrain side plates, forks, and linked beams.",
      "Complex prompts still require decomposition and source-backed interfaces before code emission.",
    ],
    featurePattern: "caption structure -> multiple rectangular members -> separate bodies -> interface cuts.",
    failureModes: ["single-body simplification", "missing interface subsystem"],
    validationRules: ["complex assembly must stay multi-body", "planned subsystems must be covered"],
    examplePrompt: "Create a belt-driven side plate or structural module frame",
    shapeType: "CUSTOM",
    componentTags: ["frame", "fork", "plate", "module"],
    operationTags: ["extrude", "boolean", "cut"],
    sampleIds: omniSummary.buckets.frame.map(entry => entry.id),
  }),
];

writeCsv(csvOutputPath, rows);
writeFileSync(jsonOutputPath, `${JSON.stringify(rows.map(row => ({
  ...row,
  tags: row.tags.split(";").filter(Boolean),
  keywords: row.keywords.split(";").filter(Boolean),
  parameter_hints: row.parameter_hints.split(";").filter(Boolean),
  modeling_notes: row.modeling_notes.split(";").filter(Boolean),
  failure_modes: row.failure_modes.split(";").filter(Boolean),
  validation_rules: row.validation_rules.split(";").filter(Boolean),
  component_tags: row.component_tags.split(";").filter(Boolean),
  operation_tags: row.operation_tags.split(";").filter(Boolean),
  sample_ids: row.sample_ids.split(";").filter(Boolean),
})), null, 2)}\n`);

console.log(JSON.stringify({
  csvOutputPath,
  jsonOutputPath,
  deepCadSummary,
  omniCaptionCount: omniSummary.captionCount,
}, null, 2));
