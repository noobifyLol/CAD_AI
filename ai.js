import Groq from "groq-sdk";

const groq         = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL   = process.env.GROQ_MODEL        || "llama-3.3-70b-versatile";
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages, model = TEXT_MODEL) {
  const res = await groq.chat.completions.create({ model, temperature: 0.0, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

const n  = x => parseFloat(Number(x).toFixed(6)).toString();
const fs = x => `${n(x)} * inch`;

// ── Sketch / operation helpers ────────────────────────────────────────────────

function preconditionBlock() {
  return `    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
    }`;
}

function planeSetup() {
  return `        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });`;
}

const filletBlock  = (ref, r) => `\n        opFillet(context, id + "fillet1", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "${ref}", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius"   : ${fs(r)}
        });`;

const chamferBlock = (ref, w) => `\n        opChamfer(context, id + "chamfer1", {
            "entities"    : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "${ref}", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width"       : ${fs(w)}
        });`;

// ── Shape templates ───────────────────────────────────────────────────────────

function templateBox(d) {
  const hw = d.widthInches / 2, hh = d.heightInches / 2;
  let body = `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "rect1", {
            "firstCorner"  : vector(${n(-hw)}, ${n(-hh)}) * inch,
            "secondCorner" : vector(${n(hw)}, ${n(hh)}) * inch
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
  if (d.filletRadiusInches > 0) body += filletBlock("extrude1", d.filletRadiusInches);
  if (d.chamferInches > 0)      body += chamferBlock("extrude1", d.chamferInches);
  return body;
}

function templateCylinder(d) {
  return `${planeSetup()}
        opCylinder(context, id + "cyl1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * ${fs(d.depthInches)},
            "radius"        : ${fs(d.radiusInches)},
            "operationType" : NewBodyOperationType.NEW
        });`;
}

function templatePolygon(d) {
  let body = `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "poly1", {
            "center"      : vector(0, 0) * inch,
            "firstVertex" : vector(${n(d.radiusInches)}, 0) * inch,
            "sides"       : ${d.sides}
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
  if (d.filletRadiusInches > 0) body += filletBlock("extrude1", d.filletRadiusInches);
  return body;
}

function templateLinkage(d) {
  const L  = d.shaftLengthInches || d.widthInches * 3;
  const W  = d.widthInches || 1;
  const T  = d.depthInches || 0.25;
  const R  = d.holeRadiusInches > 0 ? d.holeRadiusInches : W * 0.18;
  const hx = L / 2 - R * 2.5;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "body", {
            "firstCorner"  : vector(${n(-L/2)}, ${n(-W/2)}) * inch,
            "secondCorner" : vector(${n(L/2)},  ${n(W/2)})  * inch
        });
        skCircle(sketch1, "holeL", { "center" : vector(${n(-hx)}, 0) * inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "holeR", { "center" : vector(${n( hx)}, 0) * inch, "radius" : ${fs(R)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });${d.filletRadiusInches > 0 ? filletBlock("extrude1", d.filletRadiusInches) : ""}`;
}

function templatePlateHoles(d) {
  const hw  = d.widthInches / 2, hh = d.heightInches / 2;
  const num = Math.max(2, Math.round(d.numHoles || 4));
  const sp  = d.holeSpacingInches || d.widthInches / (num + 1);
  const r   = d.holeRadiusInches || 0.2;
  let circles = "";
  for (let i = 0; i < num; i++) {
    const x = -((num - 1) * sp) / 2 + i * sp;
    circles += `\n        skCircle(sketch1, "hole${i+1}", { "center" : vector(${n(x)}, 0) * inch, "radius" : ${fs(r)} });`;
  }
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "plate", {
            "firstCorner"  : vector(${n(-hw)}, ${n(-hh)}) * inch,
            "secondCorner" : vector(${n(hw)},  ${n(hh)})  * inch
        });${circles}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
}

function templateLBracket(d) {
  const { depthInches: L, widthInches: W, heightInches: H, wallThicknessInches: T } = d;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skLineSegment(sketch1, "h1", { "start" : vector(0,0)*inch,             "end" : vector(${n(W)},0)*inch });
        skLineSegment(sketch1, "h2", { "start" : vector(${n(W)},0)*inch,       "end" : vector(${n(W)},${n(T)})*inch });
        skLineSegment(sketch1, "h3", { "start" : vector(${n(W)},${n(T)})*inch, "end" : vector(${n(T)},${n(T)})*inch });
        skLineSegment(sketch1, "v1", { "start" : vector(${n(T)},${n(T)})*inch, "end" : vector(${n(T)},${n(H)})*inch });
        skLineSegment(sketch1, "v2", { "start" : vector(${n(T)},${n(H)})*inch, "end" : vector(0,${n(H)})*inch });
        skLineSegment(sketch1, "v3", { "start" : vector(0,${n(H)})*inch,        "end" : vector(0,0)*inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(L)}
        });${d.filletRadiusInches > 0 ? filletBlock("extrude1", d.filletRadiusInches) : ""}`;
}

function templateUChannel(d) {
  const { widthInches: W, heightInches: H, wallThicknessInches: T, depthInches: L } = d;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skLineSegment(sketch1, "l1", { "start" : vector(0,0)*inch,                    "end" : vector(${n(W)},0)*inch });
        skLineSegment(sketch1, "l2", { "start" : vector(${n(W)},0)*inch,              "end" : vector(${n(W)},${n(H)})*inch });
        skLineSegment(sketch1, "l3", { "start" : vector(${n(W)},${n(H)})*inch,        "end" : vector(${n(W-T)},${n(H)})*inch });
        skLineSegment(sketch1, "l4", { "start" : vector(${n(W-T)},${n(H)})*inch,      "end" : vector(${n(W-T)},${n(T)})*inch });
        skLineSegment(sketch1, "l5", { "start" : vector(${n(W-T)},${n(T)})*inch,      "end" : vector(${n(T)},${n(T)})*inch });
        skLineSegment(sketch1, "l6", { "start" : vector(${n(T)},${n(T)})*inch,        "end" : vector(${n(T)},${n(H)})*inch });
        skLineSegment(sketch1, "l7", { "start" : vector(${n(T)},${n(H)})*inch,        "end" : vector(0,${n(H)})*inch });
        skLineSegment(sketch1, "l8", { "start" : vector(0,${n(H)})*inch,              "end" : vector(0,0)*inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(L)}
        });`;
}

function templateFlange(d) {
  const R = d.radiusInches, bR = d.holeRadiusInches || 0.25;
  const cR = bR * 2, boltR = R * 0.75, num = Math.max(2, Math.round(d.numHoles || 4));
  let holes = `\n        skCircle(sketch1, "bore", { "center" : vector(0,0)*inch, "radius" : ${fs(cR)} });`;
  for (let i = 0; i < num; i++) {
    const a = (2 * Math.PI * i) / num;
    holes += `\n        skCircle(sketch1, "bh${i+1}", { "center" : vector(${n(boltR*Math.cos(a))},${n(boltR*Math.sin(a))})*inch, "radius" : ${fs(bR)} });`;
  }
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "disk", { "center" : vector(0,0)*inch, "radius" : ${fs(R)} });${holes}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches || 0.5)}
        });`;
}

function templateHexNut(d) {
  const r = d.widthInches / Math.sqrt(3), hR = d.holeRadiusInches || d.widthInches * 0.22;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "hex", { "center" : vector(0,0)*inch, "firstVertex" : vector(${n(r)},0)*inch, "sides" : 6 });
        skCircle(sketch1, "bore", { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
}

function templateWasher(d) {
  const R = d.radiusInches, hR = d.holeRadiusInches || R * 0.4;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0,0)*inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "bore",  { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches || 0.1)}
        });`;
}

function templateBushing(d) {
  const R = d.radiusInches, hR = d.holeRadiusInches || R * 0.6;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0,0)*inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "bore",  { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
}

function templateSteppedShaft(d) {
  const R1 = d.radiusInches, R2 = R1 * 0.6, L1 = d.depthInches * 0.5, L2 = d.depthInches * 0.5;
  return `${planeSetup()}
        opCylinder(context, id + "cyl1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * ${fs(L1)},
            "radius"        : ${fs(R1)},
            "operationType" : NewBodyOperationType.NEW
        });
        opCylinder(context, id + "cyl2", {
            "bottomCenter"  : skPlane.origin + skPlane.normal * ${fs(L1)},
            "topCenter"     : skPlane.origin + skPlane.normal * ${fs(L1 + L2)},
            "radius"        : ${fs(R2)},
            "operationType" : NewBodyOperationType.NEW
        });
        opBoolean(context, id + "union1", {
            "tools"         : qCreatedBy(id + "cyl2", EntityType.BODY),
            "targets"       : qCreatedBy(id + "cyl1", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });`;
}

function templateBoxWithHole(d) {
  const hw = d.widthInches / 2, hh = d.heightInches / 2;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "rect1", {
            "firstCorner"  : vector(${n(-hw)},${n(-hh)})*inch,
            "secondCorner" : vector(${n(hw)}, ${n(hh)})*inch
        });
        skCircle(sketch1, "hole1", { "center" : vector(0,0)*inch, "radius" : ${fs(d.holeRadiusInches)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });`;
}

// ── NEW: Spur Gear template ───────────────────────────────────────────────────
// Generates a proper toothed gear outline using computed tooth profiles.
// Each tooth has 4 line segments (root-land, left-flank, tip, right-flank).
// Adjacent teeth share exact endpoints so the sketch closes cleanly.

function templateSpurGear(d) {
  const teeth  = Math.max(8, Math.round(d.numTeeth || 20));
  // moduleInches: standard mechanical module converted to inches (2mm ≈ 0.0787")
  const mod    = d.moduleInches > 0 ? d.moduleInches : 0.0787402;
  const pitchR = mod * teeth / 2;
  const addR   = pitchR + mod;                           // addendum (tip) radius
  const dedR   = Math.max(mod * 0.5, pitchR - 1.25 * mod); // dedendum (root) radius
  const faceW  = d.depthInches > 0 ? d.depthInches : mod * 8;
  const boreR  = d.holeRadiusInches || 0;

  const TAU  = 2 * Math.PI;
  const ta   = TAU / teeth;   // angular pitch (radians per tooth)
  const frac = 0.38;          // tooth half-angle as fraction of angular pitch

  // Returns a FeatureScript vector literal for point (r, angle)
  const vStr = (r, a) =>
    `vector(${n(Math.cos(a) * r)}, ${n(Math.sin(a) * r)}) * inch`;

  let segs = [];
  for (let i = 0; i < teeth; i++) {
    const center = i * ta;
    // Root-land: from previous tooth's right flank to this tooth's left flank
    const aGapStart   = center - ta * (1 - frac);   // = (i-1)*ta + frac*ta  (periodic)
    const aGapEnd     = center - ta * frac;
    // Tooth flanks and tip
    const aTipLeft    = center - ta * frac * 0.5;
    const aTipRight   = center + ta * frac * 0.5;
    const aFlankRight = center + ta * frac;

    const si = i * 4;
    segs.push(`skLineSegment(sketch1, "g${si+0}", { "start" : ${vStr(dedR, aGapStart)},   "end" : ${vStr(dedR, aGapEnd)}   });`);
    segs.push(`skLineSegment(sketch1, "g${si+1}", { "start" : ${vStr(dedR, aGapEnd)},     "end" : ${vStr(addR, aTipLeft)}  });`);
    segs.push(`skLineSegment(sketch1, "g${si+2}", { "start" : ${vStr(addR, aTipLeft)},    "end" : ${vStr(addR, aTipRight)} });`);
    segs.push(`skLineSegment(sketch1, "g${si+3}", { "start" : ${vStr(addR, aTipRight)},   "end" : ${vStr(dedR, aFlankRight)} });`);
    // Note: tooth[i] aFlankRight == tooth[i+1] aGapStart  (mod 2π) → sketch closes ✓
  }

  const indent  = '        ';
  const segStr  = segs.map(s => indent + s).join('\n');
  const boreStr = boreR > 0
    ? `\n${indent}skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : ${fs(boreR)} });`
    : '';

  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
${segStr}${boreStr}
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"${boreR > 0 ? ', true' : ''}),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(faceW)}
        });`;
}

// ── FeatureScript builder ─────────────────────────────────────────────────────

function buildFeatureScript(d) {
  // Shapes that manage their own hole logic — do NOT fall through to BOX_WITH_HOLE
  const holeSafe = ["LINKAGE","PLATE_HOLES","FLANGE","HEX_NUT","WASHER","BUSHING","SPUR_GEAR"];

  let body;
  if (d.holeRadiusInches > 0 && !holeSafe.includes(d.shape)) {
    body = templateBoxWithHole(d);
  } else {
    const map = {
      CYLINDER:      templateCylinder,
      PLATE:         templateBox,
      POLYGON:       templatePolygon,
      LINKAGE:       templateLinkage,
      PLATE_HOLES:   templatePlateHoles,
      L_BRACKET:     templateLBracket,
      T_BRACKET:     templateLBracket,
      U_CHANNEL:     templateUChannel,
      FLANGE:        templateFlange,
      HEX_NUT:       templateHexNut,
      WASHER:        templateWasher,
      BUSHING:       templateBushing,
      STEPPED_SHAFT: templateSteppedShaft,
      SPUR_GEAR:     templateSpurGear,   // ← NEW
    };
    body = (map[d.shape] || templateBox)(d);
  }

  const name  = (d.featureName  || "aiShape").replace(/[^a-zA-Z0-9_]/g, "");
  const label = (d.featureLabel || "AI Shape").replace(/"/g, "'");

  return `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${label}" }
export const ${name} = defineFeature(function(context is Context, id is Id, definition is map)
${preconditionBlock()}
    {
${body}
    });
`;
}

// ── Dimension extraction system prompt ───────────────────────────────────────
// The model returns JSON + a "thinking" field showing its engineering reasoning.

const DIM_SYSTEM = `You are a mechanical CAD assistant. Read the user's part description and extract the shape type and all dimensions.
Output ONLY valid JSON — no markdown, no explanation, no preamble.

All numeric values must be in inches (convert mm ÷ 25.4, cm ÷ 2.54).

Required JSON shape:
{
  "thinking": "1–3 sentences of engineering reasoning: what is this part, what are the key dimensions, how will it be modeled?",
  "featureName": "camelCase identifier — letters and digits only",
  "featureLabel": "Human readable name",
  "shape": "shape code from the list below",
  "widthInches": 2,
  "heightInches": 2,
  "depthInches": 0.25,
  "radiusInches": 1,
  "holeRadiusInches": 0,
  "filletRadiusInches": 0,
  "chamferInches": 0,
  "sides": 6,
  "wallThicknessInches": 0.25,
  "shaftLengthInches": 4,
  "holeSpacingInches": 1.5,
  "numHoles": 4,
  "numTeeth": 20,
  "moduleInches": 0.0787402
}

SHAPE CODES — pick the single best match:
  BOX           rectangular block, cube, bar stock, base plate, slab
  CYLINDER      solid round rod, shaft, pin, column, post
  PLATE         flat thin sheet or panel with no holes
  POLYGON       regular N-sided prism — triangle (sides 3), pentagon (5), hexagon (6), octagon (8)
  LINKAGE       flat bar with exactly one circular hole near each end — connecting rod, crank arm, rocker arm
  PLATE_HOLES   flat plate with a row or grid of through-holes — mounting plate, gusset
  L_BRACKET     L-shaped cross-section — shelf bracket, corner bracket, angle iron
  T_BRACKET     T-shaped cross-section
  U_CHANNEL     U or C shaped channel — groove rail, extrusion channel
  FLANGE        round disk with central bore and bolt circle — pipe flange, weld neck
  HEX_NUT       hexagonal nut or bolt head with central bore
  WASHER        thin flat annular disk — flat washer, shim
  BUSHING       hollow cylinder — sleeve bushing, spacer tube, bearing liner
  STEPPED_SHAFT cylinder that steps to a smaller diameter mid-length — shoulder bolt, spindle
  SPUR_GEAR     toothed gear wheel, spur gear, gear with N teeth, gear ratio X:1, pinion, sprocket

DIMENSION RULES:
  "diameter X"           → radiusInches = X / 2
  "X by Y" or "X × Y"   → widthInches = X, heightInches = Y
  "across flats X"       → widthInches = X
  "OD X, ID Y"           → radiusInches = X/2, holeRadiusInches = Y/2
  holeRadiusInches = 0   → no hole
  filletRadiusInches = 0 → no fillet
  If not stated, use sensible mechanical defaults:
    body dimensions: 2 inches, wall/flange thickness: 0.25 in, small holes: 0.2 in radius, numHoles: 4

SPUR_GEAR RULES (critical — read carefully):
  numTeeth:    Tooth count on the gear.
               For "N:1 gear ratio": use numTeeth = N × 8 (minimum practical pinion = 8 teeth).
               Example: "8:1 gear" → numTeeth = 64 (driven gear, mates with an 8-tooth pinion).
               For "gear with N teeth": numTeeth = N directly.
  moduleInches: Tooth size in inches. Default 0.0787402 (= 2 mm module).
               If pitch diameter stated: moduleInches = pitchDiameter / numTeeth.
               Common modules: 1mm=0.03937, 1.5mm=0.05906, 2mm=0.07874, 3mm=0.11811.
  depthInches:  Face width (gear thickness). Default = moduleInches × 8.
  holeRadiusInches: Bore/hub hole radius. Default 0 = solid gear.

WORKED EXAMPLES:
  "8:1 spur gear, 2mm module, 0.5 inch bore"
    → SPUR_GEAR, numTeeth:64, moduleInches:0.0787402, depthInches:0.629, holeRadiusInches:0.25
    thinking: "8:1 ratio with 8-tooth minimum pinion means 64 teeth on the driven gear. Module 2mm (0.0787\") gives pitch diameter 5.04\". Face width = 8 × module = 0.63\"."

  "spur gear 20 teeth, 3mm module"
    → SPUR_GEAR, numTeeth:20, moduleInches:0.11811, depthInches:0.945, holeRadiusInches:0
    thinking: "20-tooth spur gear at 3mm module. Pitch diameter = 20 × 3mm = 60mm = 2.36\". Face width default = 8 × module = 24mm = 0.945\"."

  "6 inch connecting rod, 0.75 wide, quarter inch pin holes"
    → LINKAGE, shaftLengthInches:6, widthInches:0.75, depthInches:0.25, holeRadiusInches:0.125

  "angle iron 2×2×0.25 by 12 inches"
    → L_BRACKET, widthInches:2, heightInches:2, wallThicknessInches:0.25, depthInches:12

  "4 inch pipe flange, 6 bolt holes, half inch thick"
    → FLANGE, radiusInches:2, numHoles:6, depthInches:0.5, holeRadiusInches:0.25

  "bushing 25mm OD, 16mm ID, 40mm long"
    → BUSHING, radiusInches:0.492, holeRadiusInches:0.315, depthInches:1.575`;

// ── Dim extraction ────────────────────────────────────────────────────────────

async function extractDims(prompt) {
  const raw = await chat([
    { role: "system", content: DIM_SYSTEM },
    { role: "user",   content: prompt.trim() }
  ]);
  try {
    const d = JSON.parse(stripJson(raw));
    return {
      thinking:            String(d.thinking            ?? ""),
      featureName:         String(d.featureName         ?? "aiShape").replace(/[^a-zA-Z0-9_]/g, ""),
      featureLabel:        String(d.featureLabel        ?? "AI Shape"),
      shape:               String(d.shape               ?? "BOX"),
      widthInches:         Number(d.widthInches)        || 2,
      heightInches:        Number(d.heightInches)       || 2,
      depthInches:         Number(d.depthInches)        || 0.25,
      radiusInches:        Number(d.radiusInches)       || 1,
      holeRadiusInches:    Number(d.holeRadiusInches)   || 0,
      filletRadiusInches:  Number(d.filletRadiusInches) || 0,
      chamferInches:       Number(d.chamferInches)      || 0,
      sides:               Number(d.sides)              || 6,
      wallThicknessInches: Number(d.wallThicknessInches)|| 0.25,
      shaftLengthInches:   Number(d.shaftLengthInches)  || 4,
      holeSpacingInches:   Number(d.holeSpacingInches)  || 1.5,
      numHoles:            Number(d.numHoles)           || 4,
      numTeeth:            Number(d.numTeeth)           || 20,
      moduleInches:        Number(d.moduleInches)       || 0.0787402,
    };
  } catch {
    return {
      thinking: "Could not parse AI response — using default box geometry.",
      featureName: "simpleCube", featureLabel: "Simple Cube", shape: "BOX",
      widthInches: 2, heightInches: 2, depthInches: 2, radiusInches: 1,
      holeRadiusInches: 0, filletRadiusInches: 0, chamferInches: 0,
      sides: 6, wallThicknessInches: 0.25, shaftLengthInches: 4,
      holeSpacingInches: 1.5, numHoles: 4, numTeeth: 20, moduleInches: 0.0787402,
    };
  }
}

// ── Public exports ────────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[generate] "${prompt}"`);
  const dims = await extractDims(prompt);
  console.log(`[generate] shape=${dims.shape} teeth=${dims.numTeeth} mod=${dims.moduleInches} w=${dims.widthInches} d=${dims.depthInches}`);
  const code = buildFeatureScript(dims);
  return { code, featureName: dims.featureName, featureLabel: dims.featureLabel, thinking: dims.thinking };
}

export async function debugFeatureScript(code, errors) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[debug] ${code.length} chars`);

  const raw = await chat([
    {
      role: "system",
      content: `You are an Onshape FeatureScript debugger. Fix every error in the code the user provides.
Return a JSON object with exactly two fields:
{ "explanation": "plain English description of every problem and how you fixed it",
  "fixed": "the complete corrected FeatureScript with no markdown code fences" }

Errors to know about:
- "* inch * inch" is a double unit — remove the second "* inch"
- qOriginPlane(context, Plane.XY) should be plane(WORLD_ORIGIN, Z_DIRECTION)
- skPolygon does not exist — use skRegularPolygon
- isLength or isBoolean inside the feature body must be deleted or moved to the precondition block
- skSolve() must be called after the last sketch entity and before opExtrude
- If there are two export const blocks, keep only the last one
- Return statements in the feature body should be deleted
- Bare numbers like "endDepth": 2 are missing a unit — change to "endDepth": 2 * inch`
    },
    { role: "user", content: `FEATURESCRIPT:\n${code}\n\nERRORS:\n${errors}` }
  ]);

  try {
    const parsed = JSON.parse(stripJson(raw));
    const fixed = (parsed.fixed || code).replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed, explanation: parsed.explanation || "Fixed." };
  } catch {
    const cleaned = raw.replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed: cleaned || code, explanation: "Could not parse the structured response. Raw output shown." };
  }
}

// ── Single-image analysis (legacy endpoint, keeps backward compat) ────────────

export async function analyzeImage(imageBase64, mimeType, extraPrompt) {
  return analyzeImages(
    [{ imageBase64, mimeType, context: extraPrompt || "" }],
    extraPrompt || ""
  );
}

// ── Multi-image analysis ──────────────────────────────────────────────────────
// images: Array<{ imageBase64: string, mimeType: string, context: string }>
// globalPrompt: overall instruction from the user

export async function analyzeImages(images, globalPrompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  const count = images.length;
  console.log(`[analyze-multi] ${count} image(s)`);

  // Build multi-image content array for the vision model
  const content = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType || "image/jpeg"};base64,${img.imageBase64}` }
    });
    if (img.context && img.context.trim()) {
      content.push({ type: "text", text: `Image ${i + 1} context: ${img.context.trim()}` });
    }
  }

  content.push({
    type: "text",
    text: `You are a mechanical CAD engineer analyzing ${count} reference image${count > 1 ? "s" : ""} together.
${globalPrompt ? `The user's goal: "${globalPrompt}"` : ""}

Synthesize ALL images into a single precise part description for an Onshape FeatureScript model. Include:
- Part type and overall geometry
- All dimensions (state in inches; convert from mm if visible)
- Holes, bores, keyways, fillets, chamfers
- Gear teeth count and module if applicable
- Likely mechanical function

Write in clear sentences. Be specific. Do not use bullet points.`
  });

  const descRaw = await chat([{ role: "user", content }], VISION_MODEL);
  console.log(`[analyze-multi] vision: "${descRaw.slice(0, 100)}..."`);

  const combined = globalPrompt ? `${globalPrompt}. Based on image analysis: ${descRaw}` : descRaw;
  const { code, featureName, featureLabel, thinking } = await generateFeatureScript(combined);
  return { description: descRaw, code, featureName, featureLabel, thinking };
}