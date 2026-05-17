const TEXT_MODEL = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const FAST_MODEL = process.env.GROQ_FAST_MODEL || TEXT_MODEL;
const COMPLEX_MODEL = process.env.GROQ_COMPLEX_MODEL || TEXT_MODEL;
const DIM_MODEL = process.env.GROQ_DIM_MODEL || COMPLEX_MODEL;
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || TEXT_MODEL;
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const GENERATION_STRATEGY = String(process.env.CAD_GENERATION_MODE || "ai_first").toLowerCase();
// Templates are injected as reference examples for the AI — not used as primary output.
// Set USE_VALIDATED_TEMPLATES=false only to disable reference injection (not recommended).
const USE_VALIDATED_TEMPLATES = String(process.env.USE_VALIDATED_TEMPLATES || "true").toLowerCase() === "true";
// Emergency fallback: if AI produces unfixable code after repair passes, fall back to template output.
const ALLOW_TEMPLATE_FALLBACK = String(process.env.ALLOW_TEMPLATE_FALLBACK || "true").toLowerCase() === "true";

import Groq from "groq-sdk";

// ------------------------------
// Model configuration
// ------------------------------
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 120000);
const GROQ_MAX_COMPLETION_TOKENS = Number(process.env.GROQ_MAX_COMPLETION_TOKENS || 8192);
const GROQ_TEMPERATURE = Number(process.env.GROQ_TEMPERATURE || 0.2);
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || 12000);
const VISION_MAX_TOKENS = Number(process.env.GROQ_VISION_MAX_TOKENS || 800);

export function getModelConfig() {
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

async function callGroqVisionLLM(messages, model = VISION_MODEL) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const client = new Groq({
    apiKey,
    timeout: VISION_TIMEOUT_MS,
    maxRetries: 0,
  });

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
    });
    throw err;
  }
}

// ------------------------------
// 1. Text LLM via Groq
// ------------------------------
async function callGroqTextLLM(messagesOrPrompt, model = TEXT_MODEL) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const messages = Array.isArray(messagesOrPrompt)
    ? messagesOrPrompt
    : [{ role: "user", content: String(messagesOrPrompt) }];

  const requestBody = {
    model,
    messages,
    max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
    temperature: GROQ_TEMPERATURE,
  };

  const client = new Groq({
    apiKey,
    timeout: GROQ_TIMEOUT_MS,
    maxRetries: 0,
  });
  const startedAt = Date.now();

  try {
    console.log(`[Groq Text] model=${model} timeoutMs=${GROQ_TIMEOUT_MS}`);
    console.log(`[Groq Text] outgoing=${truncateForLog(requestBody, 800)}`);
    const completion = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: GROQ_MAX_COMPLETION_TOKENS,
      temperature: GROQ_TEMPERATURE,
    });

    const content = normalizeMessageContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      const error = new Error("Invalid Groq text response");
      error.details = { body: truncateForLog(completion, 1200) };
      throw error;
    }

    console.log(`[Groq Text] success model=${model} durationMs=${Date.now() - startedAt}`);
    return content;
  } catch (err) {
    logFetchError("Groq Text", err, { model, durationMs: Date.now() - startedAt, timeoutMs: GROQ_TIMEOUT_MS });
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
export async function callLLM(promptOrMessages, model = TEXT_MODEL) {
  console.log(`[LLM Router] using Groq model=${model} render=${Boolean(process.env.RENDER)}`);
  return await callGroqTextLLM(promptOrMessages, model);
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

async function chat(messages, model = TEXT_MODEL, fallbackModels = null, _options = {}) {
  const fallbackList = Array.isArray(fallbackModels)
    ? fallbackModels
    : (model === TEXT_MODEL ? [FALLBACK_MODEL] : []);
  const modelsToTry = [model, ...fallbackList.filter(candidate => candidate && candidate !== model)];

  let lastError = null;
  for (const candidate of modelsToTry) {
    try {
      const text = await callLLM(messages, candidate);
      if (candidate !== model) console.warn(`[AI] Used fallback model ${candidate}`);
      return text;
    } catch (err) {
      lastError = err;
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
//   - opCylinder takes: context, id, { bottomCenter, topCenter, radius, operationType }
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
  return `        annotation { "Name" : "${label}", "Default" : "${defaultValue}" }
        isInteger(definition.${paramName}, {(unitless) : [${min}, ${defaultValue}, ${max}]});`;
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
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("radius", "Radius",  0.01, d.radiusInches, 24),
      preconditionLength("height", "Height",  0.01, d.depthInches,  48),
      `        annotation { "Name" : "Hole Radius", "Default" : "${n(Math.max(0, boreDefault))} * inch" }
        isLength(definition.holeRadius, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);`,
    ].join("\n"),
    body: `${planeVar()}
        var hasBore = definition.holeRadius > 0 * inch && definition.holeRadius < definition.radius;
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.radius });
        if (hasBore)
        {
            skCircle(sketch1, "inner", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        }
        skSolve(sketch1);
        var cylEntities = hasBore ? qSketchRegion(id + "sketch1", true) : qSketchRegion(id + "sketch1");
        opExtrude(context, id + "extrude1", {
            "entities"  : cylEntities,
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.height
        });`,
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
        opCylinder(context, id + "shaft", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * definition.shaftHeight,
            "radius"        : definition.shaftRadius,
            "operationType" : NewBodyOperationType.NEW
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
        opCylinder(context, id + "seg1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * definition.length1,
            "radius"        : definition.radius1,
            "operationType" : NewBodyOperationType.NEW
        });
        opCylinder(context, id + "seg2", {
            "bottomCenter"  : skPlane.origin + skPlane.normal * definition.length1,
            "topCenter"     : skPlane.origin + skPlane.normal * (definition.length1 + definition.length2),
            "radius"        : definition.radius2,
            "operationType" : NewBodyOperationType.NEW
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
function tGear(d) {
  const radiusDefault = d.radiusInches || 1.0;
  const toothCountDefault = Math.max(6, Math.round(d.numTeeth || 20));
  const holeRadiusDefault = d.holeRadiusInches > 0 ? d.holeRadiusInches : Math.min(Math.max(radiusDefault * 0.15, 0.05), radiusDefault * 0.25);
  const faceWidthDefault = d.depthInches || 0.5;
  const pressureAngleDefault = typeof d.pressureAngleDegrees === "number" ? d.pressureAngleDegrees : 20;

  return {
    precondition: [
      preconditionPlane(),
      preconditionInteger("numTeeth", "Number of Teeth", 6, toothCountDefault, 200),
      preconditionLength("radius", "Pitch Radius", 0.01, radiusDefault, 24),
      `        annotation { "Name" : "Bore Radius", "Default" : "${n(Math.max(0, holeRadiusDefault))} * inch" }
        isLength(definition.holeRadius, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);`,
      preconditionLength("faceWidth", "Face Width (Depth)", 0.01, faceWidthDefault, 12),
      preconditionDegrees("pressureAngleDegrees", "Pressure Angle (degrees)", 10, pressureAngleDefault, 30),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });

        // Helper lambdas — FS lambdas inside a feature body MUST NOT have typed parameters.
        // "t is number" is illegal here; parameters are always untyped in const lambdas.
        const invPoint = function(t, rb)
        {
            return vector((rb * (cos(t) + t * sin(t))) * inch,
                          (rb * (sin(t) - t * cos(t))) * inch);
        };

        const rotPoint = function(p, a)
        {
            return vector(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
        };

        const mirrorPoint = function(p)
        {
            return vector(p.x, -p.y);
        };

        const N = definition.numTeeth;
        const rp = definition.radius / inch;
        const pa = definition.pressureAngleDegrees * PI / 180;
        const m = (2 * rp) / N;
        const ra = rp + m;
        const rd = max(rp - 1.35 * m, rp * 0.5);
        const rb = rp * cos(pa);
        const tRoot = rb >= rd ? 0 : sqrt(max(0, (rd / rb) * (rd / rb) - 1));
        const tTip  = sqrt(max(0, (ra / rb) * (ra / rb) - 1));
        const hasBore = definition.holeRadius > 0 * inch;

        const rf = [
            invPoint(tRoot, rb),
            invPoint(tRoot + (tTip - tRoot) * 1/5, rb),
            invPoint(tRoot + (tTip - tRoot) * 2/5, rb),
            invPoint(tRoot + (tTip - tRoot) * 3/5, rb),
            invPoint(tRoot + (tTip - tRoot) * 4/5, rb),
            invPoint(tTip, rb)
        ];

        const lf = [
            mirrorPoint(invPoint(tTip, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 4/5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 3/5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 2/5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 1/5, rb)),
            mirrorPoint(invPoint(tRoot, rb))
        ];

        for (var k = 0; k < N; k += 1)
        {
            var a = (2 * PI * k) / N;
            var rfK = [
                rotPoint(rf[0], a),
                rotPoint(rf[1], a),
                rotPoint(rf[2], a),
                rotPoint(rf[3], a),
                rotPoint(rf[4], a),
                rotPoint(rf[5], a)
            ];
            var lfK = [
                rotPoint(lf[0], a),
                rotPoint(lf[1], a),
                rotPoint(lf[2], a),
                rotPoint(lf[3], a),
                rotPoint(lf[4], a),
                rotPoint(lf[5], a)
            ];
            var tipMid = vector(ra * cos(a) * inch, ra * sin(a) * inch);
            var lfRoot = lfK[5];  // always 6 elements; FS has no .length
            var nextA = (2 * PI * (k + 1)) / N;
            var nextRF0 = rotPoint(rf[0], nextA);
            var a1 = atan2(lfRoot.y, lfRoot.x);
            var a2 = atan2(nextRF0.y, nextRF0.x);
            if (a2 < a1) a2 += 2 * PI;
            var rootMid = vector(rd * cos((a1 + a2) / 2) * inch, rd * sin((a1 + a2) / 2) * inch);
            skFitSpline(sketch1, "rf" ~ k, { "points" : rfK });
            skArc(sketch1, "tip" ~ k, { "start" : rfK[5], "mid" : tipMid, "end" : lfK[0] });
            skFitSpline(sketch1, "lf" ~ k, { "points" : lfK });
            skArc(sketch1, "root" ~ k, { "start" : lfRoot, "mid" : rootMid, "end" : nextRF0 });
        }
        if (hasBore)
        {
            skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        }
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", hasBore),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.faceWidth
        });`,
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
  });
}

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
  const examples = Array.isArray(learningContext.examples) ? learningContext.examples : [];
  const notes = Array.isArray(learningContext.notes) ? learningContext.notes : [];
  const knowledge = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const featureScriptDocs = Array.isArray(learningContext.featureScriptDocs) ? learningContext.featureScriptDocs : [];
  const promptKeywords = extractPromptKeywords(learningContext.prompt || "");
  const compileSafePatterns = knowledge
    .filter(entry => {
      const memoryType = normalizeText(entry.memory_type || entry.memoryType || "").toLowerCase();
      const featurePattern = String(entry.feature_pattern || entry.featurePattern || "");
      return memoryType.includes("fs_example")
        || /^FeatureScript Example\b/i.test(String(entry.title || ""))
        || featurePattern.startsWith("FeatureScript 2931;");
    })
    .slice(0, 2);

  if (promptKeywords.length) {
    lines.push(`User prompt keywords: ${promptKeywords.join(", ")}`);
  }

  if (notes.length) {
    lines.push("Project-specific guidance from prior runs:");
    notes.forEach((note, index) => lines.push(`${index + 1}. ${normalizeText(note)}`));
  }

  if (featureScriptDocs.length) {
    // Separate validated template references from regular docs — templates come first
    // with full code so the AI can use them as concrete structural examples.
    const templateDocs = featureScriptDocs.filter(doc => doc.source === "validated_template");
    const regularDocs = featureScriptDocs.filter(doc => doc.source !== "validated_template");

    if (templateDocs.length) {
      lines.push("SHAPE REFERENCE TEMPLATE (study this structure, then write your own):");
      lines.push("This is a compile-safe FeatureScript example for this shape type.");
      lines.push("Use it as a structural guide — precondition patterns, sketch strategy, operation order.");
      lines.push("Do NOT copy it verbatim. Write fresh code adapting it to the user's specific request.");
      templateDocs.slice(0, 1).forEach(doc => {
        lines.push(`Reference shape: ${normalizeText(doc.title || "")}`);
        lines.push(String(doc.text || "").slice(0, 3200));
      });
      lines.push("END REFERENCE TEMPLATE");
    }

    if (regularDocs.length) {
      lines.push("FeatureScript documentation to apply:");
      regularDocs.slice(0, 3).forEach((entry, index) => {
        const title = normalizeText(entry.title || `Doc ${index + 1}`);
        const source = normalizeText(entry.source || "local FS docs");
        const text = normalizeText(entry.text || "").slice(0, 520);
        lines.push(`${index + 1}. ${title} (${source})`);
        if (text) lines.push(`   ${text}`);
      });
    }
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
    lines.push(`9. opCylinder(context, id + "cyl1", { "bottomCenter": skPlane.origin, "topCenter": skPlane.origin + skPlane.normal * definition.height, "radius": r, "operationType": NewBodyOperationType.NEW });`);
    lines.push(`10. opBoolean: opBoolean(context, id + "bool1", { "tools": qCreatedBy(id+"body1", EntityType.BODY), "targets": qCreatedBy(id+"body2", EntityType.BODY), "operationType": BooleanOperationType.UNION });`);
    lines.push(`11. Remove helper variables that are computed but never used if they do not affect the final geometry.`);
    lines.push(`12. Lambdas inside feature body MUST use const: const fn = function(x is number) { return x * 2; }; — named typed functions (function foo(...) { }) are ONLY legal at module top-level.`);
  }

  if (examples.length) {
    lines.push("Similar prior generations from the database:");
    examples.slice(0, 2).forEach((example, index) => {   // was 3, now 2
      const dimsText = example.dims ? summarizeDimsForPrompt(example.dims) : "{}";
      const codeText = summarizeFeatureScript(example.featurescript, 6); // was 12 lines, now 6
      lines.push(
        `${index + 1}. Prompt="${normalizeText(example.prompt)}" | shape=${example.shape_type || "UNKNOWN"} | confidence=${example.confidence || "UNKNOWN"}`
      );
      lines.push(`   dims=${dimsText}`);
      if (codeText) lines.push(`   pattern=${codeText}`);
    });
  }

  if (compileSafePatterns.length) {
    lines.push("Compile-safe FeatureScript examples to imitate structurally:");
    compileSafePatterns.forEach((entry, index) => {
      const title = normalizeText(entry.title || `Pattern ${index + 1}`);
      const featurePattern = compactFeaturePattern(entry.feature_pattern || entry.featurePattern || "");
      lines.push(`${index + 1}. ${title}`);
      if (featurePattern) lines.push(featurePattern);
    });
  }

  if (knowledge.length) {
    lines.push("CAD modeling knowledge to apply:");
    knowledge.slice(0, 6).forEach((entry, index) => {
      const title = normalizeText(entry.title || `Knowledge ${index + 1}`);
      const summary = normalizeText(entry.summary || "").slice(0, 150);
      const hints = Array.isArray(entry.parameter_hints || entry.parameterHints) ? (entry.parameter_hints || entry.parameterHints) : [];
      const notesList = Array.isArray(entry.modeling_notes || entry.modelingNotes) ? (entry.modeling_notes || entry.modelingNotes) : [];
      const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      const failureModes = Array.isArray(entry.failure_modes || entry.failureModes) ? (entry.failure_modes || entry.failureModes) : [];
      const validationRules = Array.isArray(entry.validation_rules || entry.validationRules) ? (entry.validation_rules || entry.validationRules) : [];
      const memoryType = normalizeText(entry.memory_type || entry.memoryType || "");
      const quality = Number.isFinite(Number(entry.quality_score)) ? Number(entry.quality_score).toFixed(2) : "";
      const featurePattern = normalizeText(entry.feature_pattern || entry.featurePattern || "").slice(0, 420);

      lines.push(`${index + 1}. ${title}${summary ? ` — ${summary}` : ""}${memoryType || quality ? ` (${[memoryType, quality && `q=${quality}`].filter(Boolean).join(", ")})` : ""}`);
      if (keywords.length) lines.push(`   keywords=${keywords.slice(0, 6).join(", ")}`);
      if (hints.length) lines.push(`   parameters=${hints.slice(0, 4).map(normalizeText).join(" | ")}`);
      if (notesList.length) lines.push(`   modeling=${notesList.slice(0, 3).map(normalizeText).join(" | ")}`);
      if (featurePattern) lines.push(`   confirmed_pattern=${featurePattern}`);
      if (failureModes.length) lines.push(`   avoid=${failureModes.slice(0, 2).map(normalizeText).join(" | ")}`);
      if (validationRules.length) lines.push(`   validate=${validationRules.slice(0, 2).map(normalizeText).join(" | ")}`);
    });
  }

  return lines.join("\n").trim();
}

function withLearningContext(basePrompt, learningContext) {
  const learningText = buildLearningContextText(learningContext);
  if (!learningText) return basePrompt;
  return `${basePrompt}\n\nDATABASE CONTEXT\n${learningText}`;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
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

  // ── 1. Bounding-box diagonal (3D Euclidean magnitude) ──────────────────────
  const diag = Math.sqrt(w * w + h * h + d * d);
  hints.push(`bbox_diag=${diag.toFixed(3)}in`);

  // ── 2. Dominant axis + aspect classification ──────────────────────────────
  const maxDim = Math.max(w, h, d);
  const minDim = Math.min(w, h, d);
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
    profile.includes("slender")  ? "axial_load_dominant_consider_opCylinder_or_opExtrude" :
    genus > 0                    ? "sketch_holes_before_extrude_not_opBoolean_subtract" :
    wt > 0 && wt < 0.1           ? "keep_wall_thickness_editable_parameter" :
                                   "standard_solid_body";
  hints.push(`structural_hint=${structural}`);

  return hints.join(" | ");
}

function promptLooksComplex(prompt) {
  return /assembly|hinge|joint|cam|freeform|organic|thread|helical|spring|loft|spline|enclosure|mount|slot|rib|web|pocket|boss|complex|custom|motor|gearbox|bearing block|filleted/i.test(prompt || "");
}

// All known shapes that have a validated template — used for emergency fallback only.
// Templates are NEVER the primary output; they are injected as reference examples for the AI.
const TEMPLATE_SHAPES = new Set([
  "BOX", "ROBOT_MECH", "CYLINDER", "PLATE", "POLYGON", "LINKAGE", "PLATE_HOLES",
  "L_BRACKET", "T_BRACKET", "FLANGE", "HEX_NUT", "WASHER", "BUSHING",
  "HITCH_PEG", "GEAR_SPUR", "CONE", "STEPPED_SHAFT", "PIPE",
]);

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

// AI always generates code — no shape is ever routed to template output.
// "template_only" env override still works for CI/test environments.
function decideGenerationMode(prompt, dims) {
  if (GENERATION_STRATEGY === "template_only") {
    // Only bypass for explicit CI/testing override — not a normal user path.
    return canUseTemplateFallback(dims) ? "template" : "custom";
  }
  // All other strategies: AI generates, templates are examples.
  return "custom";
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
function sanitizeFeatureScript(code) {
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
    // opCylinder IS the correct FS function — do NOT rename it
    .replace(/^\s*"startAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*"endAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    // operationType is a valid opCylinder key — do NOT strip it
    .replace(/^\s*return\s+[^;{][^;]*;\s*$/gm, "")          // remove value-returning returns in bodies
    .replace(/\bskSpline\s*\(/g, "skFitSpline(")
    .replace(/\bskPolygon\s*\(/g, "skRegularPolygon(")
    .replace(/\bdefinition\.(\w+)\s+is\s+Length\s*;/g, 'isLength(definition.$1, LENGTH_BOUNDS);')
    .replace(/isLength\((definition\.\w+),\s*(\{[\s\S]*?\})\s*\);/g, 'isLength($1, LENGTH_BOUNDS);')
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
    .replace(/\bvar\s+([A-Za-z_]\w*)\s*=\s*function\s*\(/g, 'const $1 = function(');

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

Unit rules:
- All output in INCHES. Divide mm by 25.4.
- "diameter X" → radiusInches = X/2
- "across flats X" (hex) → widthInches = X
- "OD X ID Y" → radiusInches = X/2, holeRadiusInches = Y/2
- LINKAGE: shaftLengthInches = total length, widthInches = bar width, depthInches = thickness
- If a prompt says "hole on top", "top hole", "bore", "center hole", or "hollow cylinder", treat that as an axial hole or bore, not a decorative surface mark
- Missing dims: use sensible mechanical defaults, never 0 for main dimensions
- confidence: HIGH if all dims explicit, MEDIUM if some inferred, LOW if mostly guessed`;

async function extractDims(prompt, learningContext = {}, history = []) {
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
    const raw = await chat(messages, extractorModel, [DIM_MODEL, TEXT_MODEL, FALLBACK_MODEL]);
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
    meta.generationMode === "template_fallback"
      ? "AI-authored feature — emergency template fallback triggered after repair failure"
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
    lines.push(`  Build: opCylinder (shaft) + opRevolve (dome) + opBoolean union`);
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
  "fallbackTemplate": "revolve_carrot | loft_transition | sweep_pipe | shell_enclosure | hybrid_organic_flange | box"
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
- if validation fails, repair from pruning rules; after repair failure, use the nearest validated template.`;

const CUSTOM_FEATURE_SYSTEM = `You are an expert Onshape FeatureScript author. You write production-quality custom features.
Return ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "featureName": "camelCaseName",
  "featureLabel": "Readable Feature Name",
  "reasoning": "2-3 sentence modeling strategy",
  "code": "complete raw FeatureScript file — no backticks"
}

═══ HOW TO USE THE REFERENCE TEMPLATE IN DATABASE CONTEXT ═══
When DATABASE CONTEXT contains a "SHAPE REFERENCE TEMPLATE", do the following:
1. Read it carefully to understand the expected structure for this shape type.
2. Note the precondition patterns (isLength, isInteger, Query, boolean).
3. Note the sketch strategy (which sketch API calls, how profiles are built).
4. Note the operation order (sketch → skSolve → opExtrude/opRevolve/etc).
5. Then write COMPLETELY FRESH CODE that implements the user's specific request.
   - Use the same structural patterns, but with the user's exact dimensions.
   - Add, remove, or modify features as the prompt requires.
   - The template is a structural guide, NOT code to copy verbatim.
   - Your output MUST be meaningfully different from the template.

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
- If you do use opCylinder, the safe form is:
    opCylinder(context, id + "cyl1", {
        "bottomCenter"  : skPlane.origin,
        "topCenter"     : skPlane.origin + skPlane.normal * definition.height,
        "radius"        : definition.radius,
        "operationType" : NewBodyOperationType.NEW
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
Build each section as its own opExtrude or opCylinder call, then union adjacent bodies:

  // Pattern: build body, build part, union them
  opCylinder(context, id + "leg1", { "bottomCenter": ..., "topCenter": ..., "radius": ..., "operationType": NewBodyOperationType.NEW });
  opExtrude(context, id + "foot1", { "entities": qSketchRegion(id + "footSk"), ... });
  opBoolean(context, id + "joinLeg1", {
      "tools": qCreatedBy(id + "foot1", EntityType.BODY),
      "targets": qCreatedBy(id + "leg1", EntityType.BODY),
      "operationType": BooleanOperationType.UNION
  });

For robot/mech shapes:
- Build the torso first as a BOX (opExtrude of a rectangle)
- Add limbs as cylinders (opCylinder) positioned relative to the torso
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

async function generateCustomFeatureScript(prompt, dims, learningContext = {}, history = []) {
  const context = normalizeLearningContext(learningContext);
  const hasTemplateRef = Array.isArray(context.featureScriptDocs) &&
    context.featureScriptDocs.some(doc => doc.source === "validated_template");
  const systemPrompt = withLearningContext(CUSTOM_FEATURE_SYSTEM, context);
  const messages = [{ role: "system", content: systemPrompt }];

  // Provide the AI with its previous code so it can perform incremental edits
  for (const turn of history.slice(-3)) {
    messages.push({ role: "user", content: turn.prompt });
    messages.push({ role: "assistant", content: JSON.stringify({ reasoning: turn.reasoning, code: turn.code }) });
  }

  const isEdit = history.length > 0;
  const templateNote = hasTemplateRef
    ? `\nA SHAPE REFERENCE TEMPLATE appears in DATABASE CONTEXT above. Study its structure (preconditions, sketch strategy, operation order), then write completely fresh code that implements this request. Do not copy the template — adapt its patterns to the specific dimensions and requirements below.`
    : "";

  const userPrompt = isEdit
    ? [
        `ITERATION REQUEST: ${prompt.trim()}`,
        `PREVIOUS DIMS: ${summarizeDimsForPrompt(history[history.length-1].dims || {})}`,
        `NEW DIMS: ${summarizeDimsForPrompt(dims)}`,
        templateNote,
        `TASK: Modify the previous FeatureScript code in the conversation history to apply these changes. Keep the file complete and self-contained.`,
        `Return valid JSON only: { "featureName": "...", "featureLabel": "...", "reasoning": "...", "code": "..." }`,
      ].filter(Boolean).join("\n")
    : [
        `NEW GENERATION REQUEST: ${prompt.trim()}`,
        `Extracted dimensions: ${summarizeDimsForPrompt(dims)}`,
        templateNote,
        `Generate FeatureScript that implements exactly what the user asked for, with all dimensions editable in the Onshape feature dialog.`,
        `Return valid JSON only: { "featureName": "...", "featureLabel": "...", "reasoning": "...", "code": "..." }`,
      ].filter(Boolean).join("\n");

  messages.push({ role: "user", content: userPrompt });

  const authoringModel = promptNeedsHighFidelityModel(prompt) ? COMPLEX_MODEL : TEXT_MODEL;
  const raw = await chat(messages, authoringModel, [COMPLEX_MODEL, TEXT_MODEL, FALLBACK_MODEL]);

  try {
    const parsed = JSON.parse(stripJson(raw));
    return {
      featureName: String(parsed.featureName || dims.featureName || "customFeature"),
      featureLabel: String(parsed.featureLabel || dims.featureLabel || "Custom Feature"),
      reasoning: String(parsed.reasoning || ""),
      code: sanitizeFeatureScript(parsed.code || raw),
    };
  } catch {
    return {
      featureName: dims.featureName || "customFeature",
      featureLabel: dims.featureLabel || "Custom Feature",
      reasoning: "The generator returned a non-JSON response; raw output was sanitized.",
      code: sanitizeFeatureScript(raw),
    };
  }
}

// ─── Public: Generate ─────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt, options = {}) {
  console.log(`[AI] Generating: "${prompt}"`);

  const learningContext = normalizeLearningContext(options.learningContext);
  const history = Array.isArray(options.history) ? options.history : [];
  const dims = await extractDims(prompt, learningContext, history);
  console.log(`[AI] shape=${dims.shape} confidence=${dims.confidence}`);

  // ── Geometric reasoning ──────────────────────────────────────────────────
  const mathAnalysis = performGeometricReasoning(dims);
  learningContext.notes.push(`Geometric Reasoning: ${mathAnalysis}`);

  // ── Inject validated template as a structural reference example ──────────
  // The AI reads this to understand expected FeatureScript structure, correct
  // precondition forms, sketch strategy, and operation order for the shape.
  // It then writes its OWN code — adapted fully to the user's specific prompt.
  const templateExample = buildTemplateExampleForDims(dims);
  if (templateExample) {
    const shapeLabel = dims.shape.replace(/_/g, " ").toLowerCase();
    learningContext.featureScriptDocs = [
      {
        title: `${dims.shape} reference template`,
        source: "validated_template",
        text: templateExample,
      },
      ...(Array.isArray(learningContext.featureScriptDocs) ? learningContext.featureScriptDocs : []),
    ];
    learningContext.notes.push(
      `Shape reference: A validated ${shapeLabel} template has been provided in DATABASE CONTEXT as a structural example. ` +
      `Study its preconditions, sketch patterns, and operations, then generate fresh code for this specific request.`
    );
    console.log(`[AI] Injected ${dims.shape} template example (${templateExample.length} chars) as reference`);
  }

  const generationMode = decideGenerationMode(prompt, dims);
  let code;
  let customReasoning = "";
  let featureName = dims.featureName;
  let featureLabel = dims.featureLabel;

  if (generationMode === "template") {
    // Only reached when GENERATION_STRATEGY=template_only (CI/testing override)
    code = buildFeatureScript(dims);
  } else {
    try {
      console.log("[AI] Authoring FeatureScript (template injected as reference)...");
      const custom = await generateCustomFeatureScript(prompt, dims, learningContext, history);
      featureName = String(custom.featureName || featureName).replace(/[^a-zA-Z0-9_]/g, "") || featureName;
      featureLabel = custom.featureLabel || featureLabel;
      customReasoning = custom.reasoning;
      code = sanitizeFeatureScript(custom.code);

      // ── Validation + repair loop ─────────────────────────────────────────
      let validationIssues = validateFeatureScript(code);
      if (validationIssues.length || hasFatalFeatureScriptPatterns(code)) {
        if (validationIssues.length) {
          console.log(`[AI] Repair pass 1 — ${validationIssues.length} issues: ${validationIssues.map(i => i.message).slice(0, 3).join(" | ")}`);
        }
        const repaired = await debugFeatureScript(code, "", { learningContext });
        code = sanitizeFeatureScript(repaired.fixed);
        validationIssues = validateFeatureScript(code);
      }

      if (validationIssues.length) {
        const issueText = validationIssues
          .slice(0, 12)
          .map(i => `Line ${i.line || "?"}: ${i.message}${i.text ? ` [${i.text}]` : ""}`)
          .join("\n");
        console.log(`[AI] Repair pass 2 — ${validationIssues.length} remaining issues`);
        const repairedAgain = await debugFeatureScript(code, issueText, { learningContext });
        code = sanitizeFeatureScript(repairedAgain.fixed);
        customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Second repair pass for ${validationIssues.length} validator issue(s).`;
        validationIssues = validateFeatureScript(code);
      }

      // ── Emergency template fallback (last resort only) ───────────────────
      if (hasFatalFeatureScriptPatterns(code)) {
        if (ALLOW_TEMPLATE_FALLBACK && canUseTemplateFallback(dims)) {
          console.warn("[AI] Fatal patterns after repair — emergency template fallback.");
          code = buildFeatureScript({
            ...dims,
            shape: ["CUSTOM", "UNKNOWN"].includes(dims.shape) ? "BOX" : dims.shape,
          });
          customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Emergency template fallback: AI code still had fatal syntax after two repair passes.`;
          return {
            code, featureName, featureLabel,
            thinking: buildThinkingTrace(prompt, dims, { generationMode: "template_fallback", learningExamples: learningContext.examples.length, customReasoning }),
            dims,
            generationMode: "template_fallback",
          };
        } else {
          console.warn("[AI] Fatal patterns after repair — preserving output (template fallback disabled).");
          customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Validator warnings remain; template fallback disabled.`;
        }
      }
    } catch (err) {
      if (ALLOW_TEMPLATE_FALLBACK && canUseTemplateFallback(dims)) {
        console.warn(`[AI] Generation failed — emergency template fallback: ${err.message}`);
        code = buildFeatureScript({
          ...dims,
          shape: canUseTemplateFallback(dims) ? dims.shape : "BOX",
          featureName: featureName || "customFeature",
          featureLabel: featureLabel || "Custom Feature",
        });
        customReasoning = `Emergency template fallback after generation failure: ${err.message}`;
        return {
          code,
          featureName: featureName || "customFeature",
          featureLabel: featureLabel || "Custom Feature",
          thinking: buildThinkingTrace(prompt, dims, { generationMode: "template_fallback", learningExamples: learningContext.examples.length, customReasoning }),
          dims,
          generationMode: "template_fallback",
        };
      } else {
        console.error("[AI] Generation failed and template fallback disabled.", err?.message || String(err));
        throw err;
      }
    }
  }

  const thinking = buildThinkingTrace(prompt, dims, {
    generationMode,
    learningExamples: learningContext.examples.length,
    customReasoning,
    templateInjected: Boolean(templateExample),
  });

  console.log(`[AI] done — ${code.length} chars`);
  return { code, featureName, featureLabel, thinking, dims, generationMode };
}

// ─── Public: Debug ────────────────────────────────────────────────────────────
// The debug function must know correct FeatureScript syntax precisely.
// Common wrong fixes the AI tries that we must prevent:
//   - "definition.radius is Length" → WRONG, Length is not a type
//   - Adding startAngle/endAngle to opCylinder → those params don't exist
//   - Changing hardcoded * inch values to definition.param * inch → wrong if param isn't isLength

const DEBUG_SYSTEM = `You are an Onshape FeatureScript debugger. You know the exact API precisely.

Return ONLY a JSON object with no markdown:
{ "explanation": "plain English summary of what was wrong and what you fixed",
  "fixed": "the complete corrected raw FeatureScript — no backticks, no markdown" }

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

opCylinder signature (correct Onshape standard library function — use this for all cylinders):
  opCylinder(context, id + "cyl1", {
      "bottomCenter"  : skPlane.origin,
      "topCenter"     : skPlane.origin + skPlane.normal * definition.height,
      "radius"        : definition.radius,
      "operationType" : NewBodyOperationType.NEW
  });
  Valid keys: bottomCenter (Vector), topCenter (Vector), radius (Length), operationType.
  NO startAngle. NO endAngle. Those keys DO NOT EXIST on opCylinder.

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
2. opCylinder with startAngle/endAngle → remove those invalid keys; opCylinder is correct
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
  const addIssue = (line, message, snippet) => {
    issues.push({ line, message, text: String(snippet || "").trim() });
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (/\bisInteger\s*\(\s*definition\.\w+\s*\)\s*;/.test(line)) {
      addIssue(lineNo, "isInteger() is missing the required FS 2931 bounds map.", line);
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
        !/^\s*\/\//.test(line)) {
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
  });

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

function hasFatalFeatureScriptPatterns(code) {
  const text = String(code || "");

  // Each entry is [regex, description] — only the regex is used for the boolean check,
  // the description aids future debugging.
  const fatalPatterns = [
    // FeatureScript type errors
    [/\bdefinition\.\w+\s+is\s+Length\s*;/, "definition.x is Length (invalid type specifier)"],
    [/\bdefinition\.\w+\s+is\s+number\s*;/, "definition.x is number (invalid feature precondition syntax)"],
    [/isLength\(\s*definition\.\w+\s*,\s*\{/, "isLength with inline bounds map (use LENGTH_BOUNDS)"],
    [/\bisInteger\(\s*definition\.\w+\s*\)\s*;/, "isInteger missing required bounds map"],
    [/\"startAngle\"\s*:/, "startAngle on opCylinder — key does not exist"],

    // Invalid opCylinder params (these map keys don't exist on opCylinder)
    [/"startAngle"\s*:/, "startAngle on opCylinder (invalid key)"],
    [/"endAngle"\s*:/, "endAngle on opCylinder (invalid key)"],
    [/\bqSketchRegion\s*\(\s*(sk|sketch\w*)\s*[),]/, "qSketchRegion called with a sketch variable instead of sketch id expression"],
    [/\bqSketchEntity\s*\(/, "qSketchEntity query used where a Line or sketch id is expected"],
    [/\bopLoft[\s\S]*?"(edges|sections|vertices)"\s*:/, "opLoft with obsolete keys instead of profileSubqueries"],

    // FS has no ++ or -- operators — causes "no viable alternative" parse error
    [/\b\w+\s*\+\+\s*[;)\]]/, "increment operator ++ not valid in FeatureScript; use += 1"],
    [/\b\w+\s*--\s*[;)\]]/, "decrement operator -- not valid in FeatureScript; use -= 1"],

    // Typed lambda params inside feature body — causes "Error in initializer function arguments"
    // Lambda parameters must be untyped: function(x, y) not function(x is number, y is map)
    [/\bfunction\s*\([^)]*\s+is\s+(number|vector|map|array|boolean|string)\b[^)]*\)/, "typed parameter in lambda inside feature body; use untyped params: function(x, y)"],

    // .length on FS arrays is invalid — FS has no .length property
    [/\[\s*\w+\.length\b/, "array index using .length — FeatureScript arrays have no .length; use a hardcoded index"],

    // STRUCTURE CHECKS: FS requires ) { (no newline) and }; at end\r\n  // The defineFeature body must open with ) { on the same line, no newline between ) and {\r\n  if (/defineFeature\\s*\\(\\s*function\\s*\\([^)]*\\)\\s*\\n\\s*precondition/.test(text)) { return true; /* newline before precondition — FS requires defineFeature(...) precondition { */ } if (/defineFeature\\s*\\(\\s*function\\s*\\([^)]*\\)\\s*\\n\\s*\{/.test(text)) { return true; /* newline between ) and { */ } // FeatureScript requires closing }); (paren-brace-semicolon) at the end of the defineFeature declaration. if (/\\}\\);\\s*$/m.test(text)) { /* good */ } else if (/export const \\w+ = defineFeature/.test(text) && /\\}\\);/.test(text) === false) { return true; /* missing }; */ } // Named top-level function declared INSIDE the feature body.
    // FS spec (toplevel.md): only lambdas (const x = function(...){}) are valid inside bodies.
    // A named typed function like: function foo(x is number) returns vector { ... }
    // is only legal at module top level. Detecting this inside a feature body block.
    // Heuristic: if "function" keyword is followed by an identifier and typed args inside
    // the feature body (i.e. after defineFeature), flag it.
    [/defineFeature[\s\S]*?\bfunction\s+[a-zA-Z_]\w*\s*\(/, "named function declaration inside feature body"],

    // A sketch is created but skSolve is never called — geometry won't generate.
    // Only flag when there's a sketch creation but no skSolve anywhere in the code.
    // (We check as a pair: sketch present + skSolve absent = fatal)
    // Handled separately below as a compound check.
  ];

  if (fatalPatterns.some(([pattern]) => pattern.test(text))) return true;

  // GEAR-SPECIFIC: if the code looks like a gear (mentions gear/numTeeth/pressureAngle) but uses ONLY circles/lines without any spline for involute, flag it\r\n  const looksLikeGear = /\\bgear\\b/i.test(text) || /\\bnumTeeth\\w*\\b/.test(text) || /\\bpressureAngle\\w*\\b/.test(text);\r\n  const hasInvoluteSpline = /\\bskFitSpline\\s*\\([^)]*involute/i.test(text) || /\\binvoluteFlank\\s*:/i.test(text);\r\n  const hasToothArcs = /skArc.*(?:root|tip|flank)/i.test(text);\r\n  if (looksLikeGear && /numTeeth/i.test(text) && /skCircle/i.test(text) && !hasInvoluteSpline && !hasToothArcs) {\r\n    addIssue(0, "Gear geometry is over-simplified: concentric circles alone are not a valid finished spur gear tooth profile. Use involute-style flank splines with tip/root arcs or a robust gear example.", "(global)");\r\n  }\r\n  if (looksLikeGear && /opBoolean\\s*\\([\\s\\S]*?BooleanOperationType\\.UNION/.test(text) && /id\\s*\\+\\s*"ext1"/.test(text) && /id\\s*\\+\\s*"ext2"/.test(text)) {\r\n    addIssue(0, "Two generated gears were unioned into one body. Gear pairs should stay as separate bodies unless the prompt explicitly asks for a merged solid.", "(global)");\r\n  }\r\n\r\n  // Compound check: sketch created but skSolve never called
  const hasSketch = /\bnewSketchOnPlane\s*\(|\bnewSketch\s*\(/.test(text);
  const hasSolve  = /\bskSolve\s*\(/.test(text);
  if (hasSketch && !hasSolve) return true;

  // Nested named function check (more targeted): look for 'function <id>(' that
  // appears AFTER the feature body opening brace and before the file ends.
  // The defineFeature body is a lambda, so named function decls inside it are illegal.
  const bodyMatch = text.match(/defineFeature\s*\(\s*function\s*\([^)]*\)[^{]*\{[^{]*\{/);
  if (bodyMatch) {
    const bodyStart = text.indexOf(bodyMatch[0]) + bodyMatch[0].length;
    const bodyText = text.slice(bodyStart);
    // Match: function <name>( — the presence of a named function declaration in body
    if (/\bfunction\s+[a-zA-Z_]\w*\s*\(/.test(bodyText)) return true;
  }

  return false;
}

export async function debugFeatureScript(code, errors, options = {}) {
  const sanitizedInput = sanitizeFeatureScript(code);
  const learningContext = normalizeLearningContext(options.learningContext);
  console.log(`[AI] Debugging (${sanitizedInput.length} chars)`);

  try {
    const raw = await chat([
      { role: "system", content: withLearningContext(DEBUG_SYSTEM, learningContext) },
      { role: "user",   content: `FEATURESCRIPT:\n${sanitizedInput}\n\nONSHAPE ERRORS:\n${errors || "(none provided)"}` }
    ], COMPLEX_MODEL, [TEXT_MODEL, FALLBACK_MODEL]);
    const parsed = JSON.parse(stripJson(raw));
    const fixed = sanitizeFeatureScript(parsed.fixed || sanitizedInput);
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