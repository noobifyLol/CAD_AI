/**
 * planCompiler.js — Tier 2 of the generation pipeline.
 *
 * The LLM never writes FeatureScript here. It emits a typed JSON *build plan*
 * (parameters + a sequence of operations); this module validates the plan at the
 * plan level (unknown ops, dangling references, bad expressions → precise,
 * feedable-back errors) and then deterministically compiles it into a complete
 * FeatureScript 2931 file in the house style. Syntax errors are structurally
 * impossible because no model-written text ever reaches the emitted code except
 * validated arithmetic expressions over declared parameter names.
 */

// ─── Plan JSON schema (Groq gpt-oss strict mode compatible) ──────────────────
// Strict mode: every property required, additionalProperties false; optionality
// is expressed with nullable types.

const COORD = { type: "array", items: { type: ["string", "number"] }, minItems: 2, maxItems: 2 };
const NULLABLE_COORD = { ...COORD, type: "array" };

export const FEATURESCRIPT_PLAN_JSON_SCHEMA = {
  name: "featurescript_build_plan",
  schema: {
    type: "object",
    properties: {
      featureName: { type: "string" },
      featureLabel: { type: "string" },
      reasoning: { type: "string" },
      parameters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            kind: { type: "string", enum: ["length", "integer"] },
            min: { type: "number" },
            default: { type: "number" },
            max: { type: "number" },
          },
          required: ["name", "label", "kind", "min", "default", "max"],
          additionalProperties: false,
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "sketch", "extrude", "revolve", "loft", "sweep", "shell",
                "fillet", "chamfer", "boolean_union", "boolean_subtract",
                "circular_pattern", "linear_pattern",
              ],
            },
            id: { type: "string" },
            plane: { type: ["string", "null"] },
            entities: {
              type: ["array", "null"],
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["circle", "rectangle", "polygon", "line", "arc", "spline"] },
                  id: { type: "string" },
                  center: { ...NULLABLE_COORD, type: ["array", "null"] },
                  radius: { type: ["string", "number", "null"] },
                  corner1: { ...NULLABLE_COORD, type: ["array", "null"] },
                  corner2: { ...NULLABLE_COORD, type: ["array", "null"] },
                  firstVertex: { ...NULLABLE_COORD, type: ["array", "null"] },
                  sides: { type: ["number", "null"] },
                  start: { ...NULLABLE_COORD, type: ["array", "null"] },
                  mid: { ...NULLABLE_COORD, type: ["array", "null"] },
                  end: { ...NULLABLE_COORD, type: ["array", "null"] },
                  points: { type: ["array", "null"], items: COORD },
                },
                required: ["type", "id", "center", "radius", "corner1", "corner2", "firstVertex", "sides", "start", "mid", "end", "points"],
                additionalProperties: false,
              },
            },
            sketch: { type: ["string", "null"] },
            sketches: { type: ["array", "null"], items: { type: "string" } },
            profileSketch: { type: ["string", "null"] },
            pathSketch: { type: ["string", "null"] },
            target: { type: ["string", "null"] },
            tools: { type: ["array", "null"], items: { type: "string" } },
            value: { type: ["string", "number", "null"] },
            count: { type: ["string", "number", "null"] },
            direction: { type: ["string", "null"] },
            filterInnerLoops: { type: ["boolean", "null"] },
          },
          required: ["op", "id", "plane", "entities", "sketch", "sketches", "profileSketch", "pathSketch", "target", "tools", "value", "count", "direction", "filterInnerLoops"],
          additionalProperties: false,
        },
      },
    },
    required: ["featureName", "featureLabel", "reasoning", "parameters", "steps"],
    additionalProperties: false,
  },
};

// ─── System prompt (compact — this replaces the 6.5k-token rulebook here) ────

export function buildPlanSystemPrompt() {
  return `You are a CAD build planner. Output ONLY a JSON build plan — never FeatureScript code.

A separate deterministic compiler turns your plan into FeatureScript, so your only job is good geometry decisions.

PLAN SHAPE:
{ "featureName": "camelCase", "featureLabel": "Readable Name", "reasoning": "1-2 sentences",
  "parameters": [ { "name": "bodyRadius", "label": "Body Radius", "kind": "length"|"integer", "min": 0.1, "default": 1.5, "max": 12 } ],
  "steps": [ ...operations in build order... ] }

Unused fields in a step must be null. All coordinates/sizes are in INCHES: a number, or an arithmetic expression string over parameter names, e.g. "bodyRadius * 0.5", "-legSpacing / 2".

OPERATIONS:
- {"op":"sketch","id":"torsoSk","plane":"base","entities":[...]} — plane is "base", "offset:<expr>" (parallel plane raised by expr inches), or "vertical:<expr>" (perpendicular plane for handles/side features).
  Entities: {"type":"circle","id":"c1","center":[x,y],"radius":r} | {"type":"rectangle","id":"r1","corner1":[x1,y1],"corner2":[x2,y2]} | {"type":"polygon","id":"p1","center":[x,y],"firstVertex":[x,y],"sides":6} | {"type":"line","id":"l1","start":[x,y],"end":[x,y]} | {"type":"arc","id":"a1","start":..,"mid":..,"end":..} | {"type":"spline","id":"s1","points":[[x,y],...]}
- {"op":"extrude","id":"torsoBody","sketch":"torsoSk","value":"torsoHeight","filterInnerLoops":true|null} — value is the depth. Inner circles in the same sketch become holes when filterInnerLoops is true.
- {"op":"revolve","id":"vaseBody","sketch":"profileSk"} — revolves the sketch region 360° around the sketch's vertical axis (x=0). The profile MUST be closed: an axis line on x=0, the outer profile (spline/lines with all x >= 0), and closing lines back to the axis at top and bottom.
- {"op":"loft","id":"tipBody","sketches":["baseSk","topSk"]} — each profile is its own sketch on its own plane, in order.
- {"op":"sweep","id":"tubeBody","profileSketch":"profSk","pathSketch":"pathSk"} — path is an open wire on "base"; profile sketch should use a "vertical:0" plane.
- {"op":"shell","id":"hollow1","target":"cupBody","value":"wallThickness"} — hollows the body, opening the top face.
- {"op":"fillet","id":"round1","target":"bracketBody","value":"filletRadius"} | {"op":"chamfer",...} — value is radius/width.
- {"op":"boolean_union","id":"join1","target":"torsoBody","tools":["armBody","headBody"]} — merge tools into target.
- {"op":"boolean_subtract","id":"cut1","target":"plateBody","tools":["holeBody"]} — holes/pockets: extrude the cutting solid, then subtract it.
- {"op":"circular_pattern","id":"spokes","target":"spokeBody","count":"spokeCount"} — rotates copies of target around the base-plane center axis. count may be an integer parameter name.
- {"op":"linear_pattern","id":"fins","target":"finBody","count":"finCount","value":"finSpacing","direction":"x"|"y"} — value is the spacing.

DESIGN RULES:
1. Named real-world objects must be decomposed into recognizable components (pen = barrel + tapered tip + clip; wheel = rim + hub + patterned spokes; table = top + legs), each as its own sketch+extrude/revolve/loft, unioned at the end. Never one stretched primitive.
2. Every major dimension must be a parameter (min <= default <= max, defaults matching the user's request).
3. Position components with coordinate arithmetic; stack vertical sections using "offset:" planes.
4. 3 to 25 steps. Keep ids short, camelCase, unique.
5. Prefer few sketches with multiple entities over many single-entity sketches when parts share a plane.`;
}

// ─── Expression handling ─────────────────────────────────────────────────────

const EXPR_CHARS = /^[0-9a-zA-Z_+\-*/(). ]+$/;
const RESERVED_NAMES = new Set([
  "id", "context", "definition", "skPlane", "inch", "radian", "degree", "vector",
  "PI", "true", "false", "line", "plane", "cross", "size", "append",
]);

function numberLiteral(value) {
  return parseFloat(Number(value).toFixed(6)).toString();
}

// Returns { code } or { error }
function compileExpr(expr, paramNames, context) {
  if (typeof expr === "number" && Number.isFinite(expr)) return { code: numberLiteral(expr) };
  if (typeof expr !== "string" || !expr.trim()) return { error: `${context}: missing numeric value or expression.` };
  const text = expr.trim();
  if (!EXPR_CHARS.test(text)) return { error: `${context}: expression "${text}" contains unsupported characters (only numbers, parameter names, + - * / parentheses).` };
  const identifiers = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const identifier of identifiers) {
    if (identifier === "PI") continue;
    if (!paramNames.has(identifier)) {
      return { error: `${context}: expression "${text}" references "${identifier}", which is not a declared parameter. Declared: ${[...paramNames].join(", ") || "(none)"}.` };
    }
  }
  return { code: `(${text})` };
}

function compileCoord(coord, paramNames, context) {
  if (!Array.isArray(coord) || coord.length !== 2) return { error: `${context}: expected [x, y] coordinates.` };
  const x = compileExpr(coord[0], paramNames, `${context} x`);
  if (x.error) return x;
  const y = compileExpr(coord[1], paramNames, `${context} y`);
  if (y.error) return y;
  return { code: `vector(${x.code}, ${y.code}) * inch` };
}

// ─── Plan validation ─────────────────────────────────────────────────────────

const SKETCH_PRODUCING = new Set(["sketch"]);
const BODY_PRODUCING = new Set(["extrude", "revolve", "loft", "sweep"]);
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export function validatePlan(plan) {
  const errors = [];
  const fail = message => errors.push({ message });

  if (!plan || typeof plan !== "object") return [{ message: "Plan must be a JSON object with featureName, featureLabel, parameters, and steps." }];
  if (!NAME_PATTERN.test(String(plan.featureName || ""))) fail("featureName must be a short camelCase identifier.");
  const parameters = Array.isArray(plan.parameters) ? plan.parameters : [];
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (!parameters.length) fail("At least one length parameter is required so the part is editable.");
  if (parameters.length > 14) fail("Too many parameters (max 14).");
  if (!steps.length) fail("The plan has no steps.");
  if (steps.length > 30) fail("Too many steps (max 30).");

  const paramNames = new Set();
  for (const parameter of parameters) {
    const name = String(parameter?.name || "");
    if (!NAME_PATTERN.test(name)) { fail(`Parameter name "${name}" is invalid.`); continue; }
    if (RESERVED_NAMES.has(name) || /^(sk|pl|tr|nm|cnt)_/.test(name)) { fail(`Parameter name "${name}" is reserved.`); continue; }
    if (paramNames.has(name)) { fail(`Duplicate parameter name "${name}".`); continue; }
    if (!["length", "integer"].includes(parameter.kind)) fail(`Parameter "${name}": kind must be "length" or "integer".`);
    const { min, max } = parameter;
    const def = parameter.default;
    if (![min, def, max].every(Number.isFinite) || !(min <= def && def <= max)) {
      fail(`Parameter "${name}": bounds must satisfy min <= default <= max (got ${min}, ${def}, ${max}).`);
    }
    if (parameter.kind === "length" && min <= 0) fail(`Parameter "${name}": length min must be > 0.`);
    paramNames.add(name);
  }
  if (!parameters.some(parameter => parameter?.kind === "length")) fail("At least one parameter must be kind \"length\".");

  const sketchIds = new Set();
  const bodyIds = new Set();
  const allIds = new Set();
  const expectExpr = (value, context) => { const r = compileExpr(value, paramNames, context); if (r.error) fail(r.error); };
  const expectCoord = (value, context) => { const r = compileCoord(value, paramNames, context); if (r.error) fail(r.error); };
  const expectSketchRef = (ref, context) => { if (!sketchIds.has(String(ref || ""))) fail(`${context}: "${ref}" is not the id of an earlier sketch step. Known sketches: ${[...sketchIds].join(", ") || "(none)"}.`); };
  const expectBodyRef = (ref, context) => { if (!bodyIds.has(String(ref || ""))) fail(`${context}: "${ref}" is not the id of an earlier body-producing step (extrude/revolve/loft/sweep). Known bodies: ${[...bodyIds].join(", ") || "(none)"}.`); };

  for (const step of steps) {
    const stepId = String(step?.id || "");
    const op = String(step?.op || "");
    const where = `Step "${stepId || op}"`;
    if (!NAME_PATTERN.test(stepId)) { fail(`${where}: id must be a short camelCase identifier.`); continue; }
    if (allIds.has(stepId) || paramNames.has(stepId)) { fail(`${where}: id "${stepId}" is already used.`); continue; }
    allIds.add(stepId);

    if (op === "sketch") {
      const plane = String(step.plane || "base");
      if (plane !== "base") {
        const planeMatch = plane.match(/^(offset|vertical):(.+)$/);
        if (!planeMatch) fail(`${where}: plane must be "base", "offset:<expr>", or "vertical:<expr>" (got "${plane}").`);
        else expectExpr(planeMatch[2], `${where} plane offset`);
      }
      const entities = Array.isArray(step.entities) ? step.entities : [];
      if (!entities.length) fail(`${where}: sketch has no entities.`);
      if (entities.length > 60) fail(`${where}: too many entities (max 60).`);
      const entityIds = new Set();
      for (const entity of entities) {
        const entityId = String(entity?.id || "");
        const entityWhere = `${where} entity "${entityId || entity?.type}"`;
        if (!NAME_PATTERN.test(entityId)) { fail(`${entityWhere}: entity id is invalid.`); continue; }
        if (entityIds.has(entityId)) { fail(`${entityWhere}: duplicate entity id.`); continue; }
        entityIds.add(entityId);
        switch (entity.type) {
          case "circle":
            expectCoord(entity.center, `${entityWhere} center`);
            expectExpr(entity.radius, `${entityWhere} radius`);
            break;
          case "rectangle":
            expectCoord(entity.corner1, `${entityWhere} corner1`);
            expectCoord(entity.corner2, `${entityWhere} corner2`);
            break;
          case "polygon":
            expectCoord(entity.center, `${entityWhere} center`);
            expectCoord(entity.firstVertex, `${entityWhere} firstVertex`);
            if (!Number.isInteger(entity.sides) || entity.sides < 3 || entity.sides > 24) fail(`${entityWhere}: sides must be an integer 3-24.`);
            break;
          case "line":
            expectCoord(entity.start, `${entityWhere} start`);
            expectCoord(entity.end, `${entityWhere} end`);
            break;
          case "arc":
            expectCoord(entity.start, `${entityWhere} start`);
            expectCoord(entity.mid, `${entityWhere} mid`);
            expectCoord(entity.end, `${entityWhere} end`);
            break;
          case "spline": {
            const points = Array.isArray(entity.points) ? entity.points : [];
            if (points.length < 3) fail(`${entityWhere}: spline needs at least 3 points.`);
            points.forEach((point, index) => expectCoord(point, `${entityWhere} point ${index}`));
            break;
          }
          default:
            fail(`${entityWhere}: unknown entity type "${entity?.type}".`);
        }
      }
      sketchIds.add(stepId);
    } else if (op === "extrude") {
      expectSketchRef(step.sketch, `${where} sketch`);
      expectExpr(step.value, `${where} depth (value)`);
      bodyIds.add(stepId);
    } else if (op === "revolve") {
      expectSketchRef(step.sketch, `${where} sketch`);
      bodyIds.add(stepId);
    } else if (op === "loft") {
      const sketches = Array.isArray(step.sketches) ? step.sketches : [];
      if (sketches.length < 2) fail(`${where}: loft needs at least 2 sketches.`);
      sketches.forEach(ref => expectSketchRef(ref, `${where} sketches`));
      bodyIds.add(stepId);
    } else if (op === "sweep") {
      expectSketchRef(step.profileSketch, `${where} profileSketch`);
      expectSketchRef(step.pathSketch, `${where} pathSketch`);
      bodyIds.add(stepId);
    } else if (op === "shell" || op === "fillet" || op === "chamfer") {
      expectBodyRef(step.target, `${where} target`);
      expectExpr(step.value, `${where} value`);
    } else if (op === "boolean_union" || op === "boolean_subtract") {
      expectBodyRef(step.target, `${where} target`);
      const tools = Array.isArray(step.tools) ? step.tools : [];
      if (!tools.length) fail(`${where}: tools list is empty.`);
      tools.forEach(ref => expectBodyRef(ref, `${where} tools`));
      // The merged/cut result is itself referenceable, so later steps can shell,
      // fillet, or pattern the combined body (a plan that couldn't do this had to
      // duplicate work — gpt-oss correctly tried to and was wrongly rejected).
      bodyIds.add(stepId);
    } else if (op === "circular_pattern") {
      expectBodyRef(step.target, `${where} target`);
      expectExpr(step.count, `${where} count`);
      bodyIds.add(stepId); // patterned copies are new bodies queryable via this id
    } else if (op === "linear_pattern") {
      expectBodyRef(step.target, `${where} target`);
      expectExpr(step.count, `${where} count`);
      expectExpr(step.value, `${where} spacing (value)`);
      if (!["x", "y"].includes(step.direction)) fail(`${where}: direction must be "x" or "y".`);
      bodyIds.add(stepId);
    } else {
      fail(`${where}: unknown op "${op}".`);
    }
  }

  if (![...BODY_PRODUCING].some(op => steps.some(step => step?.op === op))) {
    fail("The plan never creates a solid body (needs at least one extrude/revolve/loft/sweep).");
  }
  return errors;
}

// ─── Compilation ─────────────────────────────────────────────────────────────

function planeExprFor(step, paramNames) {
  const plane = String(step.plane || "base");
  if (plane === "base") return { varName: "skPlane", declaration: "" };
  const planeMatch = plane.match(/^(offset|vertical):(.+)$/);
  const offset = compileExpr(planeMatch[2], paramNames, "plane offset").code;
  const varName = `pl_${step.id}`;
  const normal = planeMatch[1] === "vertical" ? "skPlane.x" : "skPlane.normal";
  return {
    varName,
    declaration: `        var ${varName} = plane(skPlane.origin + skPlane.normal * (${offset} * inch), ${normal});\n`,
  };
}

export function compilePlanToFeatureScript(plan) {
  const errors = validatePlan(plan);
  if (errors.length) return { ok: false, errors };

  const paramNames = new Set(plan.parameters.map(parameter => parameter.name));
  const expr = value => compileExpr(value, paramNames, "expr").code;
  const coord = value => compileCoord(value, paramNames, "coord").code;
  const featureName = String(plan.featureName).replace(/[^a-zA-Z0-9_]/g, "") || "plannedPart";
  const featureLabel = String(plan.featureLabel || "Planned Part").replace(/["\\]/g, "");

  const preconditionLines = [
    `        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }`,
    `        definition.location is Query;`,
  ];
  for (const parameter of plan.parameters) {
    const label = String(parameter.label || parameter.name).replace(/["\\]/g, "");
    preconditionLines.push("");
    preconditionLines.push(`        annotation { "Name" : "${label}" }`);
    if (parameter.kind === "length") {
      preconditionLines.push(`        isLength(definition.${parameter.name}, { (inch) : [${numberLiteral(parameter.min)}, ${numberLiteral(parameter.default)}, ${numberLiteral(parameter.max)}] } as LengthBoundSpec);`);
    } else {
      preconditionLines.push(`        isInteger(definition.${parameter.name}, { (unitless) : [${numberLiteral(parameter.min)}, ${numberLiteral(parameter.default)}, ${numberLiteral(parameter.max)}] } as IntegerBoundSpec);`);
    }
  }

  const body = [];
  body.push(`        var skPlane = isQueryEmpty(context, definition.location)`);
  body.push(`            ? plane(WORLD_ORIGIN, Z_DIRECTION)`);
  body.push(`            : evPlane(context, { "face" : definition.location });`);
  for (const parameter of plan.parameters) {
    body.push(parameter.kind === "length"
      ? `        var ${parameter.name} = definition.${parameter.name} / inch;`
      : `        var ${parameter.name} = definition.${parameter.name};`);
  }
  body.push("");

  const sketchPlaneVars = new Map(); // sketch step id -> plane var name
  // Which ids a boolean result may be attributed to. Onshape may track a merged
  // body under the boolean's own id or under the surviving input's id depending on
  // the operation, so a reference to a boolean step resolves through both — a
  // union of an empty sub-query contributes nothing, so this is safe either way.
  const booleanResultAliases = new Map(); // boolean step id -> [ids to query]
  const bodyQuery = ref => {
    const aliases = booleanResultAliases.get(ref);
    if (!aliases) return `qCreatedBy(id + "${ref}", EntityType.BODY)`;
    return `qUnion([${aliases.map(alias => `qCreatedBy(id + "${alias}", EntityType.BODY)`).join(", ")}])`;
  };

  for (const step of plan.steps) {
    if (step.op === "sketch") {
      const { varName, declaration } = planeExprFor(step, paramNames);
      if (declaration) body.push(declaration.trimEnd());
      sketchPlaneVars.set(step.id, varName);
      const sketchVar = `sk_${step.id}`;
      body.push(`        var ${sketchVar} = newSketchOnPlane(context, id + "${step.id}", { "sketchPlane" : ${varName} });`);
      for (const entity of step.entities) {
        if (entity.type === "circle") {
          body.push(`        skCircle(${sketchVar}, "${entity.id}", { "center" : ${coord(entity.center)}, "radius" : ${expr(entity.radius)} * inch });`);
        } else if (entity.type === "rectangle") {
          body.push(`        skRectangle(${sketchVar}, "${entity.id}", { "firstCorner" : ${coord(entity.corner1)}, "secondCorner" : ${coord(entity.corner2)} });`);
        } else if (entity.type === "polygon") {
          body.push(`        skRegularPolygon(${sketchVar}, "${entity.id}", { "center" : ${coord(entity.center)}, "firstVertex" : ${coord(entity.firstVertex)}, "sides" : ${entity.sides} });`);
        } else if (entity.type === "line") {
          body.push(`        skLineSegment(${sketchVar}, "${entity.id}", { "start" : ${coord(entity.start)}, "end" : ${coord(entity.end)} });`);
        } else if (entity.type === "arc") {
          body.push(`        skArc(${sketchVar}, "${entity.id}", { "start" : ${coord(entity.start)}, "mid" : ${coord(entity.mid)}, "end" : ${coord(entity.end)} });`);
        } else if (entity.type === "spline") {
          const points = entity.points.map(point => coord(point)).join(",\n            ");
          body.push(`        skFitSpline(${sketchVar}, "${entity.id}", { "points" : [\n            ${points}\n        ] });`);
        }
      }
      body.push(`        skSolve(${sketchVar});`);
      body.push("");
    } else if (step.op === "extrude") {
      const planeVar = sketchPlaneVars.get(step.sketch) || "skPlane";
      const inner = step.filterInnerLoops === true ? ", true" : "";
      body.push(`        opExtrude(context, id + "${step.id}", {`);
      body.push(`            "entities"  : qSketchRegion(id + "${step.sketch}"${inner}),`);
      body.push(`            "direction" : ${planeVar}.normal,`);
      body.push(`            "endBound"  : BoundingType.BLIND,`);
      body.push(`            "endDepth"  : ${expr(step.value)} * inch`);
      body.push(`        });`);
      body.push("");
    } else if (step.op === "revolve") {
      body.push(`        opRevolve(context, id + "${step.id}", {`);
      body.push(`            "entities"     : qSketchRegion(id + "${step.sketch}"),`);
      body.push(`            "axis"         : line(skPlane.origin, cross(skPlane.normal, skPlane.x)),`);
      body.push(`            "angleForward" : 2 * PI * radian`);
      body.push(`        });`);
      body.push("");
    } else if (step.op === "loft") {
      const profiles = step.sketches.map(ref => `qSketchRegion(id + "${ref}")`).join(", ");
      body.push(`        opLoft(context, id + "${step.id}", {`);
      body.push(`            "profileSubqueries" : [${profiles}]`);
      body.push(`        });`);
      body.push("");
    } else if (step.op === "sweep") {
      body.push(`        opSweep(context, id + "${step.id}", {`);
      body.push(`            "profiles" : qSketchRegion(id + "${step.profileSketch}"),`);
      body.push(`            "path"     : qCreatedBy(id + "${step.pathSketch}", EntityType.EDGE)`);
      body.push(`        });`);
      body.push("");
    } else if (step.op === "shell") {
      // qCapEntity needs the id of the operation that actually created the cap face
      // (an extrude), never a boolean id — resolve through the alias chain.
      const capSourceId = (booleanResultAliases.get(step.target) || [step.target])
        .find(alias => !booleanResultAliases.has(alias)) || step.target;
      body.push(`        opShell(context, id + "${step.id}", {`);
      body.push(`            "entities"  : qCapEntity(id + "${capSourceId}", CapType.END, EntityType.FACE),`);
      body.push(`            "thickness" : -(${expr(step.value)} * inch)`);
      body.push(`        });`);
      body.push("");
    } else if (step.op === "fillet" || step.op === "chamfer") {
      const edges = `qEdgeTopologyFilter(qOwnedByBody(${bodyQuery(step.target)}, EntityType.EDGE), EdgeTopology.TWO_SIDED)`;
      if (step.op === "fillet") {
        body.push(`        opFillet(context, id + "${step.id}", {`);
        body.push(`            "entities" : ${edges},`);
        body.push(`            "radius"   : ${expr(step.value)} * inch`);
        body.push(`        });`);
      } else {
        body.push(`        opChamfer(context, id + "${step.id}", {`);
        body.push(`            "entities"    : ${edges},`);
        body.push(`            "chamferType" : ChamferType.EQUAL_OFFSETS,`);
        body.push(`            "width"       : ${expr(step.value)} * inch`);
        body.push(`        });`);
      }
      body.push("");
    } else if (step.op === "boolean_union") {
      // Onshape-verified semantics: UNION takes ALL bodies in "tools" and must NOT
      // have a "targets" key (targets is only for SUBTRACTION/grouping) — passing
      // targets with UNION fails with BOOLEAN_BAD_INPUT in the real compiler.
      const unionBodies = [step.target, ...step.tools].map(ref => bodyQuery(ref));
      body.push(`        opBoolean(context, id + "${step.id}", {`);
      body.push(`            "tools" : qUnion([\n                ${unionBodies.join(",\n                ")}\n            ]),`);
      body.push(`            "operationType" : BooleanOperationType.UNION`);
      body.push(`        });`);
      body.push("");
      booleanResultAliases.set(step.id, [step.target, step.id]);
    } else if (step.op === "boolean_subtract") {
      const tools = step.tools.map(ref => bodyQuery(ref));
      const toolsExpr = tools.length === 1 ? tools[0] : `qUnion([\n                ${tools.join(",\n                ")}\n            ])`;
      body.push(`        opBoolean(context, id + "${step.id}", {`);
      body.push(`            "tools" : ${toolsExpr},`);
      body.push(`            "targets" : ${bodyQuery(step.target)},`);
      body.push(`            "operationType" : BooleanOperationType.SUBTRACTION`);
      body.push(`        });`);
      body.push("");
      booleanResultAliases.set(step.id, [step.target, step.id]);
    } else if (step.op === "circular_pattern" || step.op === "linear_pattern") {
      const countVar = `cnt_${step.id}`;
      const trVar = `tr_${step.id}`;
      const nmVar = `nm_${step.id}`;
      body.push(`        var ${countVar} = ${expr(step.count)};`);
      body.push(`        var ${trVar} = [];`);
      body.push(`        var ${nmVar} = [];`);
      body.push(`        for (var i = 1; i < ${countVar}; i += 1)`);
      body.push(`        {`);
      if (step.op === "circular_pattern") {
        body.push(`            ${trVar} = append(${trVar}, rotationAround(line(skPlane.origin, skPlane.normal), (i * 2 * PI / ${countVar}) * radian));`);
      } else {
        const direction = step.direction === "y" ? "cross(skPlane.normal, skPlane.x)" : "skPlane.x";
        body.push(`            ${trVar} = append(${trVar}, transform(${direction} * ((${expr(step.value)} * i) * inch)));`);
      }
      body.push(`            ${nmVar} = append(${nmVar}, "${step.id}" ~ i);`);
      body.push(`        }`);
      body.push(`        opPattern(context, id + "${step.id}", {`);
      body.push(`            "entities" : ${bodyQuery(step.target)},`);
      body.push(`            "transforms" : ${trVar},`);
      body.push(`            "instanceNames" : ${nmVar}`);
      body.push(`        });`);
      body.push("");
    }
  }

  const code = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${featureLabel}" }
export const ${featureName} = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
${preconditionLines.join("\n")}
    }
    {
${body.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}
    });
`;

  return { ok: true, code, featureName, featureLabel, reasoning: String(plan.reasoning || "") };
}
