import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const FAST_MODEL = process.env.GROQ_FAST_MODEL || "openai/gpt-oss-20b";
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "llama-3.3-70b-versatile";
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const GENERATION_STRATEGY = String(process.env.CAD_GENERATION_MODE || "ai_first").toLowerCase();
// Templates stay available as a safety net, but AI-first generation is now the default path.
const USE_VALIDATED_TEMPLATES = process.env.USE_VALIDATED_TEMPLATES !== "false";

function stripJson(text) {
  const m = text?.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : (text || "{}")).trim();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function chat(messages, model = TEXT_MODEL, fallbackModels = null) {
  const fallbackList = Array.isArray(fallbackModels)
    ? fallbackModels
    : (model === TEXT_MODEL ? [FALLBACK_MODEL] : []);
  const modelsToTry = [model, ...fallbackList.filter(candidate => candidate && candidate !== model)];

  for (const m of modelsToTry) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await groq.chat.completions.create({ model: m, temperature: 0.0, messages });
        const text = res?.choices?.[0]?.message?.content ?? "";
        if (m !== model) console.warn(`[AI] Used fallback model ${m}`);
        return text;
      } catch (err) {
        const is429 = err?.status === 429 || String(err?.message || "").includes("rate_limit");
        if (is429 && attempt < 2) {
          const wait = 8000 * (attempt + 1);   // 8 s, then 16 s
          console.warn(`[AI] TPM rate-limit on ${m}, retrying in ${wait / 1000}s…`);
          await sleep(wait);
          continue;
        }
        if (is429 && m === TEXT_MODEL) break;  // try fallback model next
        throw err;
      }
    }
  }
  throw new Error("All Groq models are rate-limited. Please wait a moment and try again.");
}

// ─── FeatureScript building blocks ───────────────────────────────────────────
//
// Key FeatureScript rules baked in here, not left to the AI:
//   - isLength(definition.foo, BOUNDS) in precondition → gives user an editable slider
//   - definition.foo in body already has Length type — do NOT multiply by * inch
//   - opCylinder takes: context, id, { bottomCenter, topCenter, radius, operationType }
//     NO startAngle / endAngle — those do not exist on opCylinder
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
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("radius", "Radius",  0.01, d.radiusInches, 24),
      preconditionLength("height", "Height",  0.01, d.depthInches,  48),
    ].join("\n"),
    // opCylinder correct signature: context, id, { bottomCenter, topCenter, radius, operationType }
    // NO startAngle, NO endAngle — those params do not exist
    body: `${planeVar()}
        opCylinder(context, id + "cyl1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * definition.height,
            "radius"        : definition.radius,
            "operationType" : NewBodyOperationType.NEW
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
            "firstCorner"  : vector(-0.5, -0.5) * definition.width,
            "secondCorner" : vector( 0.5,  0.5) * definition.height
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

// Spur gear with involute tooth profile-------------------- THIS SHOUODN"T BE a template
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

        // Helper lambdas — const assignments are legal inside a feature body (FS spec: lambdas are values)
        const invPoint = function(t is number, rb is number)
        {
            return vector((rb * (cos(t) + t * sin(t))) * inch,
                          (rb * (sin(t) - t * cos(t))) * inch);
        };

        const rotPoint = function(p, a is number)
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
            const a = (2 * PI * k) / N;
            const rfK = [
                rotPoint(rf[0], a),
                rotPoint(rf[1], a),
                rotPoint(rf[2], a),
                rotPoint(rf[3], a),
                rotPoint(rf[4], a),
                rotPoint(rf[5], a)
            ];
            const lfK = [
                rotPoint(lf[0], a),
                rotPoint(lf[1], a),
                rotPoint(lf[2], a),
                rotPoint(lf[3], a),
                rotPoint(lf[4], a),
                rotPoint(lf[5], a)
            ];
            const tipMid = vector(ra * cos(a) * inch, ra * sin(a) * inch);
            const lfRoot = lfK[lfK.length - 1];
            const nextA = (2 * PI * (k + 1)) / N;
            const nextRF0 = rotPoint(rf[0], nextA);
            const a1 = atan2(lfRoot.y, lfRoot.x);
            var a2 = atan2(nextRF0.y, nextRF0.x);
            if (a2 < a1) a2 += 2 * PI;
            const rootMid = vector(rd * cos((a1 + a2) / 2) * inch, rd * sin((a1 + a2) / 2) * inch);
            skFitSpline(sketch1, "rf" ~ k, { "points" : rfK });
            skArc(sketch1, "tip" ~ k, { "start" : rfK[rfK.length - 1], "mid" : tipMid, "end" : lfK[0] });
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
    case "HEX_NUT":     template = tHexNut(d);      break;
    case "WASHER":      template = tWasher(d);      break;
    case "BUSHING":     template = tBushing(d);     break;
    case "HITCH_PEG":   template = tHitchPeg(d);   break;
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
// Thinking 
function buildLearningContextText(learningContext = {}) {
  const lines = [];
  const examples = Array.isArray(learningContext.examples) ? learningContext.examples : [];
  const notes = Array.isArray(learningContext.notes) ? learningContext.notes : [];
  const knowledge = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const featureScriptDocs = Array.isArray(learningContext.featureScriptDocs) ? learningContext.featureScriptDocs : [];
  const promptKeywords = extractPromptKeywords(learningContext.prompt || "");

  if (promptKeywords.length) {
    lines.push(`User prompt keywords: ${promptKeywords.join(", ")}`);
  }

  if (notes.length) {
    lines.push("Project-specific guidance from prior runs:");
    notes.forEach((note, index) => lines.push(`${index + 1}. ${normalizeText(note)}`));
  }

  if (featureScriptDocs.length) {
    lines.push("FeatureScript documentation snippets to obey:");
    featureScriptDocs.slice(0, 4).forEach((entry, index) => {
      const title = normalizeText(entry.title || `Doc ${index + 1}`);
      const source = normalizeText(entry.source || "local FS docs");
      const text = normalizeText(entry.text || "").slice(0, 520);
      lines.push(`${index + 1}. ${title} (${source})`);
      if (text) lines.push(`   ${text}`);
    });
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
    lines.push(`9. opCylinder: opCylinder(context, id + "cyl1", { "bottomCenter": pt, "topCenter": pt, "radius": r, "operationType": NewBodyOperationType.NEW }); — NO startAngle/endAngle.`);
    lines.push(`10. opBoolean: opBoolean(context, id + "bool1", { "tools": qCreatedBy(id+"body1", EntityType.BODY), "targets": qCreatedBy(id+"body2", EntityType.BODY), "operationType": BooleanOperationType.UNION });`);
    lines.push(`11. Lambdas inside feature body MUST use const: const fn = function(x is number) { return x * 2; }; — named typed functions (function foo(...) { }) are ONLY legal at module top-level.`);
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
      const featurePattern = normalizeText(entry.feature_pattern || entry.featurePattern || "").slice(0, 300);

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
  if (normalized.holeRadiusInches * 2 >= normalized.radiusInches && ["WASHER", "BUSHING"].includes(normalized.shape)) {
    normalized.holeRadiusInches = Math.max(0.01, normalized.radiusInches * 0.6);
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
      wtRatio < 0.10  ? "thin_walled" :
      wtRatio < 0.25  ? "standard_shell" :
                        "solid_section";
    hints.push(`wall_ratio=${wtRatio.toFixed(3)} class=${wtClass}`);
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
    profile === "thin_plate"     ? "use_plate_or_sheet_template" :
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

function canUseTemplateFallback(dims) {
  if (!USE_VALIDATED_TEMPLATES) return false;
  return new Set([
    "BOX", "ROBOT_MECH", "CYLINDER", "PLATE", "POLYGON", "LINKAGE", "PLATE_HOLES",
    "L_BRACKET", "T_BRACKET", "FLANGE", "HEX_NUT", "WASHER", "BUSHING",
    "HITCH_PEG", "GEAR_SPUR"
  ]).has(dims.shape);
}

function decideGenerationMode(prompt, dims) {
  if (GENERATION_STRATEGY === "template_only") {
    return canUseTemplateFallback(dims) ? "template" : "custom";
  }

  if (GENERATION_STRATEGY === "template_first") {
    const simpleHighConfidence = canUseTemplateFallback(dims) && !dims.parseFailed && dims.confidence !== "LOW";
    return simpleHighConfidence && !promptLooksComplex(prompt) ? "template" : "custom";
  }

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
    .replace(/^\s*"startAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*"endAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*return\s+[^;{][^;]*;\s*$/gm, "")          // remove value-returning returns in bodies
    .replace(/\bskSpline\s*\(/g, "skFitSpline(")
    .replace(/\bdefinition\.(\w+)\s+is\s+Length\s*;/g, 'isLength(definition.$1, LENGTH_BOUNDS);')
    .replace(/isLength\((definition\.\w+),\s*(\{[\s\S]*?\})\s*\);/g, 'isLength($1, LENGTH_BOUNDS);')
    // Remove "* inch" multiplied onto a parameter already declared with isLength —
    // those params already carry Length type; multiplying by inch doubles the units.
    .replace(/\b(definition\.\w+)\s*\*\s*inch\b/g, '$1')
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
    });

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

  return cleaned.trim();
}

// ─── Dimension extractor ────────────────────────────────────────────────────── CHANGE THIS

const DIM_SYSTEM = `You are a mechanical CAD dimension extractor with engineering knowledge.
Output ONLY a valid JSON object — no markdown, no explanation.

Schema (ALL fields required, use sensible defaults for anything not stated):
{
  "featureName":          "camelCase identifier — no spaces",
  "featureLabel":         "Human readable name",
  "shape":                "see SHAPE LIST",
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
FLANGE, HEX_NUT, WASHER, BUSHING, HITCH_PEG, GEAR_SPUR

Shape classification:
ROBOT_MECH   — robotic mech, mecha, blocky robot, android, humanoid robot,
               robot made with cubes or cuboids; choose this over BOX if robot/mech appears
BOX          — cube, block, rectangular solid, billet, slab (no holes)
CYLINDER     — cylinder, rod, shaft, tube, dowel, pin, post, standoff, barrel, peg, boss
PLATE        — flat plate, sheet, panel (no holes; use PLATE_HOLES if holes present)
POLYGON      — triangle, pentagon, hexagon, N-sided prism; set sides field
LINKAGE      — connecting rod, link bar, rocker arm, crank arm, pitman arm, tie rod,
               coupler, push rod, clevis rod, train link, drive rod, lever arm;
               elongated bar with pin hole at each end
PLATE_HOLES  — mounting plate, bracket face; flat rectangle with multiple holes
L_BRACKET    — L-bracket, angle bracket, shelf bracket, corner bracket
T_BRACKET    — T-bracket, T-plate
FLANGE       — pipe flange, weld flange, bolt flange, circular plate with bolt circle
HEX_NUT      — hex nut, jam nut, lock nut, castle nut
WASHER       — washer, spacer disk, shim, flat ring
BUSHING      — bushing, sleeve, hollow tube, liner, journal bearing
HITCH_PEG    — hitch peg, mushroom head pin, thumb peg, lollipop pin,
               any pin with a domed or spherical head on a cylindrical shaft
GEAR_SPUR    — spur gear, gear wheel, pinion, drive gear, driven gear,
               any gear described by tooth count or gear ratio

Mechanical engineering defaults:
GEARS — pressure angle 20deg standard; "8:1 ratio" → numTeeth=40, radiusInches=2.5 (8 DP);
        "diametral pitch P, N teeth" → radiusInches = N/(2P);
        default face width = 0.5 * pitch_diameter; bore = 0.3 * pitch_radius
BOLTS — M3=0.118in, M4=0.157in, M5=0.197in, M6=0.236in, M8=0.315in, M10=0.394in;
        #6=0.138in, #8=0.164in, #10=0.190in, 1/4=0.25in, 3/8=0.375in
GEARS — pressure angle is normally 20°, use 14.5° for older gears and 25° for stronger teeth; expose pressure angle when user requests specific tooth form.
HITCH PEG — shaft diameter from widthInches, head radius from radiusInches, shaft height from depthInches
ROBOT MECH — default widthInches=12, heightInches=12, depthInches=6; expose all as editable parameters

Unit rules:
- All output in INCHES. Divide mm by 25.4.
- "diameter X" → radiusInches = X/2
- "across flats X" (hex) → widthInches = X
- "OD X ID Y" → radiusInches = X/2, holeRadiusInches = Y/2
- LINKAGE: shaftLengthInches = total length, widthInches = bar width, depthInches = thickness
- Missing dims: use sensible mechanical defaults, never 0 for main dimensions
- confidence: HIGH if all dims explicit, MEDIUM if some inferred, LOW if mostly guessed`;

async function extractDims(prompt, learningContext = {}) {
  const context = normalizeLearningContext(learningContext);
  const raw = await chat([
    { role: "system", content: withLearningContext(DIM_SYSTEM, context) },
    { role: "user",   content: prompt.trim() }
  ], FAST_MODEL, [TEXT_MODEL, FALLBACK_MODEL]);
  try {
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
  } catch {
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
      ? "AI-authored feature attempted, validated template fallback used"
      : meta.generationMode === "custom"
        ? "AI-authored parametric feature"
        : "Validated template";
  lines.push(`Generation mode: ${generationLabel}`);

  if (meta.learningExamples) {
    lines.push(`Database context: used ${meta.learningExamples} similar prior generation(s) as guidance.`);
  }

  if (d.shape === "GEAR_SPUR") {
    const m = (2 * d.radiusInches) / d.numTeeth;
    lines.push(`Gear math:`);
    lines.push(`  Teeth: ${d.numTeeth}  Pitch radius: ${d.radiusInches.toFixed(4)} in  Module: ${m.toFixed(4)} in`);
    lines.push(`  Tip radius: ${(d.radiusInches + m).toFixed(4)} in  Root radius: ${Math.max(d.radiusInches - 1.35*m, d.radiusInches*0.5).toFixed(4)} in`);
    lines.push(`  Pressure angle: 20deg standard  |  ${d.numTeeth * 4} sketch entities`);
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
const CUSTOM_FEATURE_SYSTEM = `You are an expert Onshape FeatureScript author. You write production-quality custom features.
Return ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "featureName": "camelCaseName",
  "featureLabel": "Readable Feature Name",
  "reasoning": "2-3 sentence modeling strategy",
  "code": "complete raw FeatureScript file — no backticks"
}

═══ MANDATORY FILE STRUCTURE ═══
Every file must follow this exact structure:

  FeatureScript 2931;
  import(path : "onshape/std/geometry.fs", version : "2931.0");

  annotation { "Feature Type Name" : "My Feature" }
  export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
      precondition
      {
          // parameter declarations here
      }
      {
          // feature body here
      });

═══ PRECONDITION RULES (from official FS docs) ═══
- User-selectable plane:
    annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
    definition.location is Query;
- Length parameter (ALWAYS use this form — never "definition.x is Length"):
    annotation { "Name" : "Width", "Default" : "2 * inch" }
    isLength(definition.width, LENGTH_BOUNDS);
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
- definition.depth is already a Length value from isLength() — NEVER write definition.depth * inch.
- opCylinder valid keys: "bottomCenter" (Vector), "topCenter" (Vector), "radius" (Length), "operationType".
  NO startAngle, NO endAngle — those do not exist on opCylinder.
- opRevolve: { "entities": Query, "axis": Line, "angleForward": 2 * PI * radian }
- opBoolean: { "tools": Query, "targets": Query, "operationType": BooleanOperationType.UNION }

═══ FUNCTION SCOPE RULE — THE #1 CAUSE OF PARSE ERRORS ═══
The feature body is a LAMBDA (anonymous function) passed to defineFeature.
Named top-level functions (function foo(...) returns T { }) are ILLEGAL inside a lambda.
WRONG — causes "missing TOP_SEMI" and "no viable alternative" parse errors:
    function invPoint(t is number, rb is number) returns vector { ... }
RIGHT — const lambda is a VALUE, legal inside any scope:
    const invPoint = function(t is number, rb is number) { return ...; };
Use const lambdas for ALL helper functions inside the feature body.

═══ SKETCH API ═══
- skLineSegment(sk, "line1", { "start": vector(0,0) * inch, "end": vector(1,0) * inch });
- skCircle(sk, "circ1", { "center": vector(0,0) * inch, "radius": definition.radius });
- skRectangle(sk, "rect1", { "firstCorner": vector(-w/2,-h/2) * inch, "secondCorner": vector(w/2,h/2) * inch });
  (w and h are plain numbers here — multiply by inch to make them Length vectors)
- skFitSpline(sk, "spline1", { "points": [vector(x1,y1) * inch, vector(x2,y2) * inch, ...] });
- skRegularPolygon(sk, "poly1", { "center": vector(0,0) * inch, "firstVertex": vector(r,0) * inch, "sides": 6 });
  ("skPolygon" does NOT exist — always use skRegularPolygon)

═══ COMMON MISTAKES TO AVOID ═══
1. Writing "definition.x is Length" in precondition — WRONG. Use isLength(definition.x, LENGTH_BOUNDS).
2. Writing "definition.x * inch" in the body when x is an isLength param — doubles the units, WRONG.
3. Using startAngle or endAngle on opCylinder — those keys DO NOT EXIST.
4. Forgetting skSolve(sk) before opExtrude — sketch geometry will not appear without it.
5. Named functions (function foo() {}) inside the feature body — use const lambdas instead.
6. Using "skPolygon" — it does not exist. Use skRegularPolygon.
7. Raw numbers in geometry operations — always attach units: vector(1, 0) * inch, not vector(1, 0).

═══ GOAL ═══
- Author a fresh FeatureScript design from the request and the context below. Do not default to a canned box, plate, or gear template unless the request is extremely simple.
- Build exactly what the user asked for, with sensible parametric defaults.
- Every parameter must be editable in the Onshape feature dialog.
- Prefer simple, robust geometry over clever but brittle geometry.
- The code must compile and produce visible 3D geometry with zero errors.`;

async function generateCustomFeatureScript(prompt, dims, learningContext = {}) {
  const context = normalizeLearningContext(learningContext);
  const systemPrompt = withLearningContext(CUSTOM_FEATURE_SYSTEM, context);
  const userPrompt = [
    `User request: ${prompt.trim()}`,
    `Extracted dimensions: ${summarizeDimsForPrompt(dims)}`,
    `Start from the user's requested design intent, not from a stock template. Build the geometry strategy yourself.`,
    `If the part is still ambiguous, prefer a flexible parametric interpretation that the user can edit in Onshape.`,
    `Return valid JSON only.`
  ].join("\n");

  const raw = await chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ], TEXT_MODEL, [FALLBACK_MODEL]);

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
      reasoning: "The generator returned a non-JSON response, so the raw code was sanitized and repaired.",
      code: sanitizeFeatureScript(raw),
    };
  }
}

// ─── Public: Generate ─────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt, options = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Generating: "${prompt}"`);

  const learningContext = normalizeLearningContext(options.learningContext);
  const dims = await extractDims(prompt, learningContext);
  console.log(`[AI] shape=${dims.shape} confidence=${dims.confidence}`);

  // Add geometric reasoning to the learning context before generation
  const mathAnalysis = performGeometricReasoning(dims);
  learningContext.notes.push(`Geometric Reasoning: ${mathAnalysis}`);

  let generationMode = decideGenerationMode(prompt, dims);
  let code;
  let customReasoning = "";
  let featureName = dims.featureName;
  let featureLabel = dims.featureLabel;

  if (generationMode === "template") {
    code = buildFeatureScript(dims);
  } else {
    const custom = await generateCustomFeatureScript(prompt, dims, learningContext);
    featureName = String(custom.featureName || featureName).replace(/[^a-zA-Z0-9_]/g, "") || featureName;
    featureLabel = custom.featureLabel || featureLabel;
    customReasoning = custom.reasoning;

    const repaired = await debugFeatureScript(custom.code, "", {
      learningContext,
    });
    code = sanitizeFeatureScript(repaired.fixed);

    const validationIssues = validateFeatureScript(code);
    if (validationIssues.length) {
      const issueText = validationIssues
        .slice(0, 12)
        .map(issue => `Line ${issue.line || "?"}: ${issue.message}${issue.text ? ` [${issue.text}]` : ""}`)
        .join("\n");
      const repairedAgain = await debugFeatureScript(code, issueText, {
        learningContext,
      });
      code = sanitizeFeatureScript(repairedAgain.fixed);
      customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Validator triggered a second repair pass for ${validationIssues.length} issue(s).`;
    }

    if (hasFatalFeatureScriptPatterns(code) && canUseTemplateFallback(dims)) {
      console.warn("[AI] Fatal FeatureScript patterns remained after repair; falling back to validated template.");
      code = buildFeatureScript({
        ...dims,
        shape: ["CUSTOM", "UNKNOWN"].includes(dims.shape) ? "BOX" : dims.shape,
      });
      generationMode = "template_fallback";
      customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Fallback used because the AI-authored code still contained invalid FeatureScript type or bounds syntax.`;
    }
  }

  const thinking = buildThinkingTrace(prompt, dims, {
    generationMode,
    learningExamples: learningContext.examples.length,
    customReasoning,
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

opCylinder signature:
  opCylinder(context is Context, id is Id, definition is map)
  Map keys: "bottomCenter" (Vector), "topCenter" (Vector), "radius" (Length), "operationType" (NewBodyOperationType)
  NO startAngle. NO endAngle. NO angle params whatsoever.

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

opBoolean: { "tools": Query, "targets": Query, "operationType": BooleanOperationType.UNION|SUBTRACTION }

skRegularPolygon: { "center": Vector, "firstVertex": Vector, "sides": integer }
  (not skPolygon — that function does not exist)

skFitSpline: valid sketch spline API
  skFitSpline(sketch, "spline1", { "points": [...] })
  "skSpline" is not a valid sketch API name.

LAMBDA TYPES:
  "vector" (lowercase) is a constructor function, not a type declaration.
  WRONG: function(p is vector, a is number)
  RIGHT: function(p, a is number)

FUNCTION SCOPE RULE (causes "missing TOP_SEMI" and "no viable alternative" parse errors):
  Named typed top-level functions are ONLY legal at MODULE TOP LEVEL.
  Inside a feature body (the lambda passed to defineFeature) they are ILLEGAL.
  WRONG — causes parse errors:
    function invPoint(t is number, rb is number) returns vector { ... }
  RIGHT — const lambda is legal inside a feature body:
    const invPoint = function(t is number, rb is number) { ... };
  If the broken code has named functions inside the feature body, move them to module
  top level (before the annotation block) OR convert them to const lambda form.

FIX RULES:
1. "definition.param is Length" → change to "isLength(definition.param, LENGTH_BOUNDS);" in precondition
2. startAngle / endAngle on opCylinder → remove those lines entirely
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
11. skSolve missing after sketch entities → add skSolve(sketch1); before opExtrude/opRevolve`;

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

    // Invalid opCylinder params (these map keys don't exist on opCylinder)
    [/"startAngle"\s*:/, "startAngle on opCylinder (invalid key)"],
    [/"endAngle"\s*:/, "endAngle on opCylinder (invalid key)"],

    // Named top-level function declared INSIDE the feature body.
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

  // Compound check: sketch created but skSolve never called
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
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  const sanitizedInput = sanitizeFeatureScript(code);
  const learningContext = normalizeLearningContext(options.learningContext);
  console.log(`[AI] Debugging (${sanitizedInput.length} chars)`);

  const raw = await chat([
    { role: "system", content: withLearningContext(DEBUG_SYSTEM, learningContext) },
    { role: "user",   content: `FEATURESCRIPT:\n${sanitizedInput}\n\nONSHAPE ERRORS:\n${errors || "(none provided)"}` }
  ], TEXT_MODEL, [FALLBACK_MODEL]);

  try {
    const parsed = JSON.parse(stripJson(raw));
    const fixed = sanitizeFeatureScript(parsed.fixed || sanitizedInput);
    return { fixed, explanation: parsed.explanation || "Fixed." };
  } catch {
    return { fixed: sanitizedInput, explanation: "Could not parse the AI response. The sanitized original code is returned unchanged." };
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
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");

  const userPayload = {
    prompt,
    signal,
    rating,
    feedback,
    errorMessages,
    databaseSnapshot: compactLearningSnapshot(snapshot),
  };

  const raw = await chat([
    { role: "system", content: LEARNING_OUTCOME_SYSTEM },
    { role: "user", content: JSON.stringify(userPayload).slice(0, 12000) },
  ]);

  try {
    return JSON.parse(stripJson(raw));
  } catch {
    return {
      summary: "The learning auditor returned non-JSON output, so a fallback lesson was created.",
      whatWentWrong: errorMessages || feedback || "No issue reported",
      weightAdvice: Number(rating) >= 4 || signal === "good"
        ? "Positive feedback should slightly increase matching memory quality scores."
        : "Negative feedback should decrease matching memory quality scores and save the failure as a lesson.",
      nextPromptGuidance: "Prefer compile-safe parametric FeatureScript with editable dimensions and conservative operations.",
      memoryCandidate: {
        title: `Feedback lesson ${Date.now()}`,
        summary: normalizeText(feedback || errorMessages || prompt || "CAD generation feedback"),
        shapeType: snapshot?.generation?.shape_type || "CUSTOM",
        tags: ["feedback", signal || "learning"],
        keywords: extractPromptKeywords(prompt || "", 6),
        parameterHints: [],
        modelingNotes: ["Keep generated dimensions editable and validate FeatureScript syntax before returning code."],
        failureModes: errorMessages ? [normalizeText(errorMessages).slice(0, 240)] : [],
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
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
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

  const descRaw = await chat([{ role: "user", content }], VISION_MODEL);

  // Cap the description so the downstream generateFeatureScript calls stay within TPM limits.
  // Vision descriptions can be very long; 600 chars is plenty for dimension extraction.
  const descForGen = descRaw.length > 600 ? descRaw.slice(0, 600) + "…" : descRaw;
  const combinedPrompt = extraPrompt ? `${extraPrompt}. From images: ${descForGen}` : descForGen;

  const generated = await generateFeatureScript(combinedPrompt, options);
  return { description: descRaw, ...generated };
}
