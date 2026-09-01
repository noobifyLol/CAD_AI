// Regression harness for the Tier-2 plan compiler.
// Run with: npm run test:plan
// Offline part: hand-written plans must compile into validator-clean FeatureScript
// with zero sanitizer changes, and bad plans must produce precise plan-level errors.
// Onshape part (skipped if unconfigured): compiled plans must pass the real compiler.
import dotenv from "dotenv";
dotenv.config();
const { validatePlan, compilePlanToFeatureScript } = await import("../planCompiler.js");
const { validateFeatureScriptStrict } = await import("../ai.js");
const { isOnshapeConfigured, testCompileFeatureScript } = await import("../onshapeClient.js");

let failures = 0;
const nullStep = { plane: null, entities: null, sketch: null, sketches: null, profileSketch: null, pathSketch: null, target: null, tools: null, value: null, count: null, direction: null, filterInnerLoops: null };

const mugPlan = {
  featureName: "plannedMug",
  featureLabel: "Planned Mug",
  reasoning: "Cup body shelled open plus a vertical-plane ring handle unioned on.",
  parameters: [
    { name: "cupRadius", label: "Cup Radius", kind: "length", min: 0.5, default: 1.5, max: 6 },
    { name: "cupHeight", label: "Cup Height", kind: "length", min: 1, default: 3.5, max: 10 },
    { name: "wallThickness", label: "Wall Thickness", kind: "length", min: 0.04, default: 0.12, max: 0.5 },
    { name: "handleRadius", label: "Handle Radius", kind: "length", min: 0.2, default: 0.8, max: 3 },
  ],
  steps: [
    { ...nullStep, op: "sketch", id: "cupSk", plane: "base", entities: [
      { type: "circle", id: "outer", center: [0, 0], radius: "cupRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "cupBody", sketch: "cupSk", value: "cupHeight" },
    { ...nullStep, op: "shell", id: "cupShell", target: "cupBody", value: "wallThickness" },
    { ...nullStep, op: "sketch", id: "handleSk", plane: "vertical:cupHeight / 2", entities: [
      { type: "circle", id: "hOuter", center: ["cupRadius", 0], radius: "handleRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
      { type: "circle", id: "hInner", center: ["cupRadius", 0], radius: "handleRadius - wallThickness * 1.5", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "handleBody", sketch: "handleSk", value: "wallThickness * 1.5", filterInnerLoops: true },
    { ...nullStep, op: "boolean_union", id: "joinHandle", target: "cupBody", tools: ["handleBody"] },
  ],
};

const platePlan = {
  featureName: "plannedPlate",
  featureLabel: "Planned Plate",
  reasoning: "Plate with two subtracted mounting holes and a fillet.",
  parameters: [
    { name: "plateWidth", label: "Plate Width", kind: "length", min: 1, default: 3, max: 12 },
    { name: "plateHeight", label: "Plate Height", kind: "length", min: 1, default: 2, max: 12 },
    { name: "plateThickness", label: "Thickness", kind: "length", min: 0.05, default: 0.25, max: 1 },
    { name: "holeRadius", label: "Hole Radius", kind: "length", min: 0.05, default: 0.125, max: 0.5 },
  ],
  steps: [
    { ...nullStep, op: "sketch", id: "plateSk", plane: "base", entities: [
      { type: "rectangle", id: "plate", corner1: ["-plateWidth / 2", "-plateHeight / 2"], corner2: ["plateWidth / 2", "plateHeight / 2"], center: null, radius: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "plateBody", sketch: "plateSk", value: "plateThickness" },
    { ...nullStep, op: "sketch", id: "holeSk", plane: "base", entities: [
      { type: "circle", id: "left", center: ["-plateWidth / 2 + holeRadius * 3", 0], radius: "holeRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
      { type: "circle", id: "right", center: ["plateWidth / 2 - holeRadius * 3", 0], radius: "holeRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "holeTools", sketch: "holeSk", value: "plateThickness" },
    { ...nullStep, op: "boolean_subtract", id: "cutHoles", target: "plateBody", tools: ["holeTools"] },
    { ...nullStep, op: "fillet", id: "soften", target: "plateBody", value: "plateThickness * 0.2" },
  ],
};

const patternPlan = {
  featureName: "plannedHub",
  featureLabel: "Planned Hub",
  reasoning: "Disc with circular-patterned pegs and linear-patterned fins.",
  parameters: [
    { name: "discRadius", label: "Disc Radius", kind: "length", min: 0.5, default: 2, max: 8 },
    { name: "discThickness", label: "Disc Thickness", kind: "length", min: 0.05, default: 0.25, max: 1 },
    { name: "pegRadius", label: "Peg Radius", kind: "length", min: 0.05, default: 0.2, max: 1 },
    { name: "pegCount", label: "Peg Count", kind: "integer", min: 2, default: 6, max: 16 },
  ],
  steps: [
    { ...nullStep, op: "sketch", id: "discSk", plane: "base", entities: [
      { type: "circle", id: "disc", center: [0, 0], radius: "discRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "discBody", sketch: "discSk", value: "discThickness" },
    { ...nullStep, op: "sketch", id: "pegSk", plane: "offset:discThickness", entities: [
      { type: "circle", id: "peg", center: ["discRadius * 0.7", 0], radius: "pegRadius", corner1: null, corner2: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "pegBody", sketch: "pegSk", value: "pegRadius * 2" },
    { ...nullStep, op: "circular_pattern", id: "pegRing", target: "pegBody", count: "pegCount" },
    { ...nullStep, op: "boolean_union", id: "unionAll", target: "discBody", tools: ["pegBody", "pegRing"] },
  ],
};

// Exercises referencing a boolean RESULT downstream (shell + fillet after union) —
// the case a real gpt-oss plan produced and the validator initially rejected.
const postBooleanPlan = {
  featureName: "plannedBin",
  featureLabel: "Planned Bin",
  reasoning: "Two merged blocks, then hollow and soften the combined body.",
  parameters: [
    { name: "binWidth", label: "Bin Width", kind: "length", min: 1, default: 3, max: 12 },
    { name: "binDepth", label: "Bin Depth", kind: "length", min: 1, default: 2, max: 12 },
    { name: "binHeight", label: "Bin Height", kind: "length", min: 0.5, default: 2, max: 12 },
    { name: "wallThickness", label: "Wall", kind: "length", min: 0.04, default: 0.12, max: 0.5 },
  ],
  steps: [
    { ...nullStep, op: "sketch", id: "mainSk", plane: "base", entities: [
      { type: "rectangle", id: "main", corner1: ["-binWidth / 2", "-binDepth / 2"], corner2: ["binWidth / 2", "binDepth / 2"], center: null, radius: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "mainBody", sketch: "mainSk", value: "binHeight" },
    { ...nullStep, op: "sketch", id: "lipSk", plane: "base", entities: [
      { type: "rectangle", id: "lip", corner1: ["binWidth / 2 - wallThickness", "-binDepth / 2"], corner2: ["binWidth / 2 + binWidth / 4", "binDepth / 2"], center: null, radius: null, firstVertex: null, sides: null, start: null, mid: null, end: null, points: null },
    ] },
    { ...nullStep, op: "extrude", id: "lipBody", sketch: "lipSk", value: "binHeight" },
    { ...nullStep, op: "boolean_union", id: "merged", target: "mainBody", tools: ["lipBody"] },
    { ...nullStep, op: "shell", id: "hollow", target: "merged", value: "wallThickness" },
    { ...nullStep, op: "fillet", id: "soften", target: "merged", value: "wallThickness * 0.4" },
  ],
};

const plans = [["mug", mugPlan], ["plate", platePlan], ["patternHub", patternPlan], ["postBoolean", postBooleanPlan]];
const compiledById = {};
for (const [name, plan] of plans) {
  const planErrors = validatePlan(plan);
  if (planErrors.length) {
    failures += 1;
    console.log(`FAIL plan-valid ${name}:`, planErrors.slice(0, 4).map(e => e.message));
    continue;
  }
  const compiled = compilePlanToFeatureScript(plan);
  if (!compiled.ok) { failures += 1; console.log(`FAIL compile ${name}:`, compiled.errors.slice(0, 4)); continue; }
  const strict = validateFeatureScriptStrict(compiled.code);
  const changes = (strict.sanitizerChanges || []).map(change => change.rule);
  if (strict.ok && changes.length === 0) {
    console.log(`PASS offline ${name} (${compiled.code.length} chars)`);
    compiledById[name] = compiled.code;
  } else {
    failures += 1;
    console.log(`FAIL strict ${name} — ok=${strict.ok} changes=${JSON.stringify(changes)}`);
    for (const issue of [...strict.blockingIssues, ...strict.fatalIssues].slice(0, 6)) console.log("   ISSUE:", issue.message, "|", (issue.text || "").slice(0, 80));
  }
}

// Negative tests: plan-level errors must be precise
const badPlan = { ...platePlan, steps: platePlan.steps.map(step => step.id === "cutHoles" ? { ...step, tools: ["doesNotExist"] } : step) };
const badErrors = validatePlan(badPlan);
console.log(badErrors.some(e => /doesNotExist.*not the id of an earlier body/i.test(e.message) || /not the id of an earlier body-producing/.test(e.message))
  ? "PASS negative (dangling body ref caught)"
  : (failures += 1, `FAIL negative: ${JSON.stringify(badErrors.slice(0, 3))}`));

const badExprPlan = { ...mugPlan, steps: mugPlan.steps.map(step => step.id === "cupBody" ? { ...step, value: "cupHeight + hackerFunc()" } : step) };
const exprErrors = validatePlan(badExprPlan);
console.log(exprErrors.some(e => /not a declared parameter|unsupported characters/.test(e.message))
  ? "PASS negative (bad expression caught)"
  : (failures += 1, `FAIL negative expr: ${JSON.stringify(exprErrors.slice(0, 3))}`));

// Real Onshape compile check
if (isOnshapeConfigured()) {
  for (const [name, code] of Object.entries(compiledById)) {
    const result = await testCompileFeatureScript(code);
    if (result.ok === true) console.log(`PASS onshape ${name}`);
    else if (result.ok === null) console.log(`SKIP onshape ${name} — ${result.skippedReason}`);
    else { failures += 1; console.log(`FAIL onshape ${name}:`, result.errors.slice(0, 4).map(e => e.message)); }
  }
} else {
  console.log("SKIP onshape checks (not configured)");
}

console.log(failures === 0 ? "\nALL PLAN COMPILER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
