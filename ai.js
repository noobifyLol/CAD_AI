import Groq from "groq-sdk";

const groq         = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL   = process.env.GROQ_MODEL        || "llama-3.3-70b-versatile";
const VISION_MODEL = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages, model = TEXT_MODEL) {
  const res = await groq.chat.completions.create({ model, temperature: 0.0, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

const n  = x  => parseFloat(Number(x).toFixed(6)).toString();
const fs = x  => `${n(x)} * inch`;

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
        skLineSegment(sketch1, "l1", { "start" : vector(0,0)*inch,                   "end" : vector(${n(W)},0)*inch });
        skLineSegment(sketch1, "l2", { "start" : vector(${n(W)},0)*inch,              "end" : vector(${n(W)},${n(H)})*inch });
        skLineSegment(sketch1, "l3", { "start" : vector(${n(W)},${n(H)})*inch,        "end" : vector(${n(W-T)},${n(H)})*inch });
        skLineSegment(sketch1, "l4", { "start" : vector(${n(W-T)},${n(H)})*inch,      "end" : vector(${n(W-T)},${n(T)})*inch });
        skLineSegment(sketch1, "l5", { "start" : vector(${n(W-T)},${n(T)})*inch,      "end" : vector(${n(T)},${n(T)})*inch });
        skLineSegment(sketch1, "l6", { "start" : vector(${n(T)},${n(T)})*inch,        "end" : vector(${n(T)},${n(H)})*inch });
        skLineSegment(sketch1, "l7", { "start" : vector(${n(T)},${n(H)})*inch,        "end" : vector(0,${n(H)})*inch });
        skLineSegment(sketch1, "l8", { "start" : vector(0,${n(H)})*inch,               "end" : vector(0,0)*inch });
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

function buildFeatureScript(d) {
  const holeSafe = ["LINKAGE","PLATE_HOLES","FLANGE","HEX_NUT","WASHER","BUSHING"];
  let body;
  if (d.holeRadiusInches > 0 && !holeSafe.includes(d.shape)) {
    body = templateBoxWithHole(d);
  } else {
    const map = {
      CYLINDER: templateCylinder, PLATE: templateBox, POLYGON: templatePolygon,
      LINKAGE: templateLinkage, PLATE_HOLES: templatePlateHoles,
      L_BRACKET: templateLBracket, T_BRACKET: templateLBracket, U_CHANNEL: templateUChannel,
      FLANGE: templateFlange, HEX_NUT: templateHexNut, WASHER: templateWasher,
      BUSHING: templateBushing, STEPPED_SHAFT: templateSteppedShaft,
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

const DIM_SYSTEM = `You are a mechanical CAD assistant. Read the user's part description and extract the shape type and all dimensions.
Output ONLY valid JSON. No markdown, no explanation, no commentary.

All numeric values must be in inches. Do not include unit strings inside the JSON.

{
  "featureName": "camelCase identifier, letters and digits only, no spaces",
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
  "numHoles": 4
}

SHAPE CODES — pick the single best match:
  BOX           rectangular block, cube, bar stock, base plate, slab
  CYLINDER      solid round rod, shaft, pin, column, post
  PLATE         flat thin sheet or panel with no holes
  POLYGON       regular N-sided prism — triangle (sides 3), pentagon (5), hexagon (6), octagon (8)
  LINKAGE       flat bar with exactly one circular hole near each end — connecting rod, crank arm, rocker arm, tie rod, coupler
  PLATE_HOLES   flat plate with a row or grid of through-holes — mounting plate, gusset, backing plate
  L_BRACKET     L-shaped or angle-shaped cross-section — shelf bracket, corner bracket, angle iron
  T_BRACKET     T-shaped cross-section
  U_CHANNEL     U or C shaped channel — groove rail, extrusion channel
  FLANGE        round disk with a central bore and bolt holes spaced around the edge — pipe flange, weld neck
  HEX_NUT       hexagonal nut or hex bolt head with a central bore
  WASHER        thin flat annular disk — flat washer, shim
  BUSHING       hollow cylinder — sleeve bushing, spacer tube, bearing liner
  STEPPED_SHAFT cylinder that changes to a smaller diameter partway along — shoulder bolt, spindle

DIMENSION EXTRACTION RULES:
  millimeters: divide by 25.4 to convert to inches
  centimeters: divide by 2.54
  "diameter X" means radiusInches = X / 2
  "X by Y" or "X x Y" means widthInches = X, heightInches = Y
  "across flats X" for hex shapes: widthInches = X
  "OD X, ID Y" means radiusInches = X/2, holeRadiusInches = Y/2
  For LINKAGE: shaftLengthInches = total bar length, widthInches = bar width, holeRadiusInches = pin hole radius
  If a dimension is not stated, use a sensible mechanical default:
    main body length/width/height: 2 inches
    wall or flange thickness: 0.25 inches
    small holes: 0.2 inch radius
    numHoles: 4 for flanges and mounting plates
  holeRadiusInches = 0 means no hole
  filletRadiusInches = 0 means no fillet

WORKED EXAMPLES:
  "6 inch connecting rod, 0.75 wide, quarter inch pin holes"
    -> LINKAGE, shaftLengthInches:6, widthInches:0.75, depthInches:0.25, holeRadiusInches:0.125

  "angle iron 2x2x0.25 by 12 inches long"
    -> L_BRACKET, widthInches:2, heightInches:2, wallThicknessInches:0.25, depthInches:12

  "M10 hex nut"
    -> HEX_NUT, widthInches:0.63, depthInches:0.315, holeRadiusInches:0.197

  "4 inch flanged coupling with 6 bolt holes, half inch thick"
    -> FLANGE, radiusInches:2, numHoles:6, depthInches:0.5, holeRadiusInches:0.25

  "round stock 2 inch diameter by 8 inches"
    -> CYLINDER, radiusInches:1, depthInches:8

  "bushing 25mm OD, 16mm ID, 40mm long"
    -> BUSHING, radiusInches:0.492, holeRadiusInches:0.315, depthInches:1.575

  "aluminum 6061 block 3x2x1"
    -> BOX, widthInches:3, heightInches:2, depthInches:1

  "equilateral triangle prism 1.5 inch side, 3 inches tall"
    -> POLYGON, sides:3, radiusInches:0.866, depthInches:3`;

async function extractDims(prompt) {
  const raw = await chat([
    { role: "system", content: DIM_SYSTEM },
    { role: "user",   content: prompt.trim() }
  ]);
  try {
    const d = JSON.parse(stripJson(raw));
    return {
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
    };
  } catch {
    return {
      featureName: "simpleCube", featureLabel: "Simple Cube", shape: "BOX",
      widthInches: 2, heightInches: 2, depthInches: 2, radiusInches: 1,
      holeRadiusInches: 0, filletRadiusInches: 0, chamferInches: 0,
      sides: 6, wallThicknessInches: 0.25, shaftLengthInches: 4, holeSpacingInches: 1.5, numHoles: 4,
    };
  }
}

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[generate] "${prompt}"`);
  const dims = await extractDims(prompt);
  console.log(`[generate] ${dims.shape} w=${dims.widthInches} h=${dims.heightInches} d=${dims.depthInches} L=${dims.shaftLengthInches} hole=${dims.holeRadiusInches}`);
  const code = buildFeatureScript(dims);
  return { code, featureName: dims.featureName, featureLabel: dims.featureLabel };
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

export async function analyzeImage(imageBase64, mimeType, extraPrompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[analyze] ${mimeType}`);

  const descRaw = await chat([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        {
          type: "text",
          text: `You are a mechanical CAD engineer. Analyze this image of a part or CAD model.
${extraPrompt ? `The user also said: "${extraPrompt}"` : ""}
Describe the part clearly for a CAD system. Include the shape type, approximate dimensions in inches, any holes, fillets, or chamfers visible, and what the part is likely used for. Write in plain sentences. Do not use bullet points, arrows, or special characters.`
        }
      ]
    }
  ], VISION_MODEL);

  console.log(`[analyze] "${descRaw.slice(0, 80)}..."`);
  const combined = extraPrompt ? `${extraPrompt}. Based on this image: ${descRaw}` : descRaw;
  const { code, featureName, featureLabel } = await generateFeatureScript(combined);
  return { description: descRaw, code, featureName, featureLabel };
}