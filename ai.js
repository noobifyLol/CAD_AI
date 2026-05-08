import Groq from "groq-sdk";

const groq           = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL     = process.env.GROQ_MODEL        || "llama-3.3-70b-versatile";
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant";
const VISION_MODEL   = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function stripJson(text) {
  const m = text?.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : (text || "{}")).trim();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function chat(messages, model = TEXT_MODEL) {
  const modelsToTry = model === TEXT_MODEL
    ? [TEXT_MODEL, FALLBACK_MODEL]
    : [model];                          // vision model — no fallback

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

// ─── Shape templates ──────────────────────────────────────────────────────────
// Each template returns { precondition: string, body: string }.
// The precondition block goes between the two { } blocks of defineFeature.
// The body goes inside the second { } block.
// definition.paramName values already carry Length — never multiply by * inch.

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
            "firstCorner"  : ${fsPoint("-definition.width / 2", "-definition.height / 2")},
            "secondCorner" : ${fsPoint("definition.width / 2", "definition.height / 2")}
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
            "firstCorner"  : ${fsPoint("-definition.length / 2", "-definition.width / 2")},
            "secondCorner" : ${fsPoint("definition.length / 2", "definition.width / 2")}
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
            "firstCorner"  : ${fsPoint("-definition.width / 2", "-definition.height / 2")},
            "secondCorner" : ${fsPoint("definition.width / 2", "definition.height / 2")}
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
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skLineSegment(sketch1, "h1", { "start" : vector(0, 0)                       * inch, "end" : vector(1, 0)                        * definition.armWidth  });
        skLineSegment(sketch1, "h2", { "start" : vector(1, 0)  * definition.armWidth, "end" : vector(1, 1)   * definition.wall          });
        skLineSegment(sketch1, "h3", { "start" : vector(1, 1)  * definition.wall,     "end" : vector(1, 1)   * definition.wall          });
        skLineSegment(sketch1, "v1", { "start" : vector(0, 0)  * definition.wall,     "end" : vector(0, 1)   * definition.armHeight     });
        skLineSegment(sketch1, "v2", { "start" : vector(0, 1)  * definition.armHeight,"end" : vector(-1, 1)  * definition.wall          });
        skLineSegment(sketch1, "v3", { "start" : vector(-1, 1) * definition.wall,     "end" : vector(0, 0)   * inch                     });
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
// Uses opSphere approximated via a revolved semicircle on a construction plane
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

// Spur gear with involute tooth profile
function tGear(d) {
  const N  = Math.max(6, Math.round(d.numTeeth || 20));
  const pa = 20 * Math.PI / 180;
  const rp = d.radiusInches || 1.0;
  const m  = (2 * rp) / N;
  const ra = rp + m;
  const rd = Math.max(rp - 1.35 * m, rp * 0.5);
  const rb = rp * Math.cos(pa);
  const hR = d.holeRadiusInches > 0 ? d.holeRadiusInches : Math.min(rd * 0.45, rp * 0.25);
  const T  = d.depthInches || 0.5;
  const invPA = Math.tan(pa) - pa;
  const halfT = Math.PI / N;
  const tRoot = rb >= rd ? 0 : Math.sqrt(Math.max(0, (rd / rb) ** 2 - 1));
  const tTip  = Math.sqrt(Math.max(0, (ra / rb) ** 2 - 1));
  const rot0  = halfT - invPA;
  function inv(t) { return { x: rb*(Math.cos(t)+t*Math.sin(t)), y: rb*(Math.sin(t)-t*Math.cos(t)) }; }
  function rot(p, a) { return { x: p.x*Math.cos(a)-p.y*Math.sin(a), y: p.x*Math.sin(a)+p.y*Math.cos(a) }; }
  function v2(p) { return `vector(${n(p.x)}, ${n(p.y)}) * inch`; }
  const NPTS = 5;
  const rf = [];
  for (let i = 0; i <= NPTS; i++) {
    const t = tRoot + (tTip - tRoot) * (i / NPTS);
    rf.push(rot(inv(t), rot0));
  }
  const lf = [...rf].reverse().map(p => ({ x: p.x, y: -p.y }));
  const lines = [];
  for (let k = 0; k < N; k++) {
    const a = (2*Math.PI*k)/N;
    const R = p => rot(p, a);
    const rfK = rf.map(R), lfK = lf.map(R);
    const tipMid = { x: ra*Math.cos(a), y: ra*Math.sin(a) };
    const lfRoot = lfK[lfK.length-1];
    const nextA  = (2*Math.PI*(k+1))/N;
    const nextRF0 = rot(rf[0], nextA);
    const a1 = Math.atan2(lfRoot.y, lfRoot.x);
    let   a2 = Math.atan2(nextRF0.y, nextRF0.x);
    if (a2 < a1) a2 += 2*Math.PI;
    const rootMid = { x: rd*Math.cos((a1+a2)/2), y: rd*Math.sin((a1+a2)/2) };
    lines.push(
      `        skSpline(sketch1, "rf${k}", { "points" : [${rfK.map(v2).join(', ')}] });`,
      `        skArc(sketch1, "tip${k}", { "start" : ${v2(rfK[rfK.length-1])}, "mid" : ${v2(tipMid)}, "end" : ${v2(lfK[0])} });`,
      `        skSpline(sketch1, "lf${k}", { "points" : [${lfK.map(v2).join(', ')}] });`,
      `        skArc(sketch1, "root${k}", { "start" : ${v2(lfRoot)}, "mid" : ${v2(rootMid)}, "end" : ${v2(nextRF0)} });`
    );
  }
  const bore = hR > 0 ? `\n        skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : ${n(hR)} * inch });` : "";
  return {
    precondition: [
      preconditionPlane(),
      preconditionLength("faceWidth", "Face Width (Depth)", 0.01, T, 12),
    ].join("\n"),
    body: `${planeVar()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
${lines.join('\n')}${bore}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"${hR > 0 ? ', true' : ''}),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.faceWidth
        });`,
  };
}

// ─── Assemble full FeatureScript file ─────────────────────────────────────────

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

function buildLearningContextText(learningContext = {}) {
  const lines = [];
  const examples = Array.isArray(learningContext.examples) ? learningContext.examples : [];
  const notes = Array.isArray(learningContext.notes) ? learningContext.notes : [];
  const knowledge = Array.isArray(learningContext.knowledge) ? learningContext.knowledge : [];
  const promptKeywords = extractPromptKeywords(learningContext.prompt || "");

  if (promptKeywords.length) {
    lines.push(`User prompt keywords: ${promptKeywords.join(", ")}`);
  }

  if (notes.length) {
    lines.push("Project-specific guidance from prior runs:");
    notes.forEach((note, index) => lines.push(`${index + 1}. ${normalizeText(note)}`));
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
    knowledge.slice(0, 3).forEach((entry, index) => {
      const title = normalizeText(entry.title || `Knowledge ${index + 1}`);
      const summary = normalizeText(entry.summary || "").slice(0, 120); // cap summary
      const hints = Array.isArray(entry.parameter_hints || entry.parameterHints) ? (entry.parameter_hints || entry.parameterHints) : [];
      const notesList = Array.isArray(entry.modeling_notes || entry.modelingNotes) ? (entry.modeling_notes || entry.modelingNotes) : [];
      const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
      const failureModes = Array.isArray(entry.failure_modes || entry.failureModes) ? (entry.failure_modes || entry.failureModes) : [];
      const validationRules = Array.isArray(entry.validation_rules || entry.validationRules) ? (entry.validation_rules || entry.validationRules) : [];
      const memoryType = normalizeText(entry.memory_type || entry.memoryType || "");
      const quality = Number.isFinite(Number(entry.quality_score)) ? Number(entry.quality_score).toFixed(2) : "";
      const featurePattern = normalizeText(entry.feature_pattern || entry.featurePattern || "").slice(0, 180);

      lines.push(`${index + 1}. ${title}${summary ? ` — ${summary}` : ""}${memoryType || quality ? ` (${[memoryType, quality && `q=${quality}`].filter(Boolean).join(", ")})` : ""}`);
      if (keywords.length) lines.push(`   keywords=${keywords.slice(0, 5).join(", ")}`);
      if (hints.length) lines.push(`   parameters=${hints.slice(0, 3).map(normalizeText).join(" | ")}`);
      if (notesList.length) lines.push(`   modeling=${notesList.slice(0, 2).map(normalizeText).join(" | ")}`);
      if (featurePattern) lines.push(`   pattern=${featurePattern}`);
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

function promptLooksComplex(prompt) {
  return /assembly|hinge|joint|cam|freeform|organic|thread|helical|spring|loft|spline|enclosure|mount|slot|rib|web|pocket|boss|complex|custom|motor|gearbox|bearing block|filleted/i.test(prompt || "");
}

function shouldUseTemplate(prompt, dims) {
  const simpleShapes = new Set([
    "BOX", "ROBOT_MECH", "CYLINDER", "PLATE", "POLYGON", "LINKAGE", "PLATE_HOLES",
    "L_BRACKET", "T_BRACKET", "FLANGE", "HEX_NUT", "WASHER", "BUSHING",
    "HITCH_PEG", "GEAR_SPUR"
  ]);

  if (dims.parseFailed) return false;
  if (!simpleShapes.has(dims.shape)) return false;
  if (dims.shape === "ROBOT_MECH") return true;
  if (dims.confidence === "LOW") return false;
  if (promptLooksComplex(prompt)) return false;
  return true;
}

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

  cleaned = cleaned
    .replace(/^\s*"startAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*"endAngle"\s*:\s*[^,\n]+,?\s*$/gm, "")
    .replace(/^\s*return\s+[^;]*;\s*$/gm, "")
    .replace(/\bdefinition\.(\w+)\s+is\s+Length\s*;/g, 'isLength(definition.$1, LENGTH_BOUNDS);')
    .replace(/isLength\((definition\.\w+),\s*(\{[\s\S]*?\})\s*\);/g, 'isLength($1, LENGTH_BOUNDS);');

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

// ─── Dimension extractor ──────────────────────────────────────────────────────

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
  const raw = await chat([
    { role: "system", content: withLearningContext(DIM_SYSTEM, learningContext) },
    { role: "user",   content: prompt.trim() }
  ]);
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
  lines.push(`Generation mode: ${meta.generationMode === "custom" ? "AI-authored parametric feature" : "Validated template"}`);

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

  lines.push(`Template: parametric — user can adjust all dimensions in the Onshape dialog`);
  if (d.confidence === "LOW") {
    lines.push(`Note: Low confidence — dimensions were not stated explicitly and are estimated.`);
  }
  if (meta.customReasoning) {
    lines.push(`Custom model notes: ${normalizeText(meta.customReasoning)}`);
  }
  return lines.join("\n");
}

const CUSTOM_FEATURE_SYSTEM = `You are an expert Onshape FeatureScript author.
Return ONLY a JSON object:
{
  "featureName": "camelCaseName",
  "featureLabel": "Readable Feature Name",
  "reasoning": "1-3 sentence summary of the modeling strategy",
  "code": "complete raw FeatureScript file"
}

Your job is to generate flexible, editable, compile-safe FeatureScript for complex or custom 3D parts.

Hard rules from the Onshape FeatureScript docs:
- Define exactly one custom feature with annotation { "Feature Type Name" : ... } and export const ...
- Use a precondition block with editable parameters. Prefer isLength(...) for dimensions, isInteger(...) for counts, and booleans for toggles.
- Never write "definition.someParam is Length". That is invalid FeatureScript. Use isLength(definition.someParam, LENGTH_BOUNDS); or a typed custom bound spec.
- Prefer LENGTH_BOUNDS for all length parameters and set the initial value through annotation { "Default" : "1 * inch" }.
- If the prompt does not provide every dimension, choose sensible defaults and expose them as parameters so the user can change them later.
- Use newSketchOnPlane(...) or newSketch(..., { "sketchPlane" : ... }) for sketches and call skSolve(...) before opExtrude/opRevolve.
- Use operation definition maps such as opExtrude(context, id + "extrude1", { ... }).
- Do not invent APIs or map fields. Do not use startAngle/endAngle on opCylinder.
- When a definition parameter already comes from isLength(...), use definition.param directly in the body. Do not multiply it by * inch again.
- Avoid duplicate export const blocks, markdown fences, comments about uncertainty, or placeholder TODO code.
- Prefer robust, simple geometry over flashy but brittle code.

Goal:
- Match the user's requested shape as closely as possible.
- Keep the model adjustable in the Onshape dialog.
- Minimize the chance of FeatureScript syntax or map/type errors.`;

async function generateCustomFeatureScript(prompt, dims, learningContext = {}) {
  const systemPrompt = withLearningContext(CUSTOM_FEATURE_SYSTEM, learningContext);
  const userPrompt = [
    `User request: ${prompt.trim()}`,
    `Extracted dimensions: ${summarizeDimsForPrompt(dims)}`,
    `If the part is still ambiguous, prefer a flexible parametric interpretation that the user can edit in Onshape.`,
    `Return valid JSON only.`
  ].join("\n");

  const raw = await chat([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ]);

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

  const dims = await extractDims(prompt, options.learningContext);
  console.log(`[AI] shape=${dims.shape} confidence=${dims.confidence}`);

  const generationMode = shouldUseTemplate(prompt, dims) ? "template" : "custom";
  let code;
  let customReasoning = "";
  let featureName = dims.featureName;
  let featureLabel = dims.featureLabel;

  if (generationMode === "template") {
    code = buildFeatureScript(dims);
  } else {
    const custom = await generateCustomFeatureScript(prompt, dims, options.learningContext);
    featureName = String(custom.featureName || featureName).replace(/[^a-zA-Z0-9_]/g, "") || featureName;
    featureLabel = custom.featureLabel || featureLabel;
    customReasoning = custom.reasoning;

    const repaired = await debugFeatureScript(custom.code, "", {
      learningContext: options.learningContext,
    });
    code = sanitizeFeatureScript(repaired.fixed);

    if (hasFatalFeatureScriptPatterns(code)) {
      console.warn("[AI] Fatal FeatureScript patterns remained after repair; falling back to validated template.");
      code = buildFeatureScript({
        ...dims,
        shape: ["CUSTOM", "UNKNOWN"].includes(dims.shape) ? "BOX" : dims.shape,
      });
      customReasoning = `${customReasoning ? `${customReasoning} ` : ""}Fallback used because the AI-authored code still contained invalid FeatureScript type or bounds syntax.`;
    }
  }

  const thinking = buildThinkingTrace(prompt, dims, {
    generationMode,
    learningExamples: Array.isArray(options.learningContext?.examples) ? options.learningContext.examples.length : 0,
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

FIX RULES:
1. "definition.param is Length" → change to "isLength(definition.param, LENGTH_BOUNDS);" in precondition
2. startAngle / endAngle on opCylinder → remove those lines entirely
3. definition.param * inch in body when param is isLength → remove the * inch
4. Raw number without units in geometry (e.g. "endDepth" : 2) → add * inch or use a definition param
5. newSketch used with evPlane result → change to newSketchOnPlane
6. skPolygon → skRegularPolygon
7. Multiple export const → keep only the last block
8. return statement in body (other than bare "return;") → delete`;

function hasFatalFeatureScriptPatterns(code) {
  const text = String(code || "");
  return [
    /\bdefinition\.\w+\s+is\s+Length\s*;/,
    /isLength\(\s*definition\.\w+\s*,\s*\{/,
    /"startAngle"\s*:/,
    /"endAngle"\s*:/,
  ].some(pattern => pattern.test(text));
}

export async function debugFeatureScript(code, errors, options = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  const sanitizedInput = sanitizeFeatureScript(code);
  console.log(`[AI] Debugging (${sanitizedInput.length} chars)`);

  const raw = await chat([
    { role: "system", content: withLearningContext(DEBUG_SYSTEM, options.learningContext) },
    { role: "user",   content: `FEATURESCRIPT:\n${sanitizedInput}\n\nONSHAPE ERRORS:\n${errors || "(none provided)"}` }
  ]);

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
