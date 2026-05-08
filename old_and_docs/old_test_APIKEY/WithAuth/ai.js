import Groq from "groq-sdk";

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages) {
  const res = await groq.chat.completions.create({ model: MODEL, temperature: 0.0, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

// ─── Stage 1: Dimension + Shape Extractor ─────────────────────────────────────
// AI only outputs JSON — never FeatureScript, never code.

async function extractDims(prompt) {
  const raw = await chat([
    {
      role: "system",
      content: `You are a CAD dimension extractor. Given a natural-language description of a mechanical part,
output ONLY a valid JSON object. No markdown. No explanation. No code.

OUTPUT SCHEMA:
{
  "featureName": "camelCase identifier e.g. linkageArm",
  "featureLabel": "Human name e.g. Linkage Arm",
  "shape": "one of the shape codes below",
  "widthInches":  2.0,
  "heightInches": 2.0,
  "depthInches":  2.0,
  "radiusInches": 1.0,
  "holeRadiusInches": 0.0,
  "filletRadiusInches": 0.0,
  "chamferInches": 0.0,
  "sides": 4,
  "wallThicknessInches": 0.2,
  "flangeWidthInches": 0.5,
  "flangeHeightInches": 0.5,
  "shaftLengthInches": 2.0,
  "nutWidthInches": 1.0,
  "nutHeightInches": 0.5,
  "holeSpacingInches": 1.0,
  "numHoles": 2
}

SHAPE CODES — pick the BEST match:
  BOX            — simple rectangular block, cube, brick
  CYLINDER       — rod, shaft, pole, column, tube (solid)
  PLATE          — flat thin rectangular plate or sheet
  POLYGON        — any regular N-sided prism: triangle (sides:3), hexagon (sides:6), etc.
  LINKAGE        — flat rectangular arm/bar with a circular hole at each end (connecting rod, linkage arm, coupler, clevis, rocker arm, crank arm, tie rod)
  PLATE_HOLES    — flat plate with a grid or row of holes (mounting plate, bracket plate, gusset with holes)
  L_BRACKET      — L-shaped profile (angle bracket, L-bracket, corner bracket, shelf bracket)
  T_BRACKET      — T-shaped profile (T-slot, T-bracket)
  U_CHANNEL      — U-shaped channel or slot (C-channel, U-channel, groove)
  FLANGE         — round disk with a central hole and bolt holes around the edge (pipe flange, weld neck flange)
  HEX_NUT        — hexagonal nut or hex bolt head
  WASHER         — thin flat disk with a central hole
  STEPPED_SHAFT  — cylinder with two different diameters (stepped rod, shoulder bolt, lathe spindle)
  BUSHING        — hollow cylinder / thin-walled tube (sleeve, bushing, spacer)
  GEAR_BLANK     — solid cylinder for a gear (gear blank, sprocket blank)

DIMENSION RULES:
- All values are in inches (plain numbers)
- "mm" → divide by 25.4, "cm" → divide by 2.54
- "diameter X" → radiusInches = X / 2
- "X × Y" → widthInches=X, heightInches=Y
- Missing dimension → use sensible mechanical default
- holeRadiusInches: 0 means no hole
- filletRadiusInches: 0 means no fillet
- numHoles: number of holes for PLATE_HOLES and FLANGE
- holeSpacingInches: center-to-center spacing of holes

EXAMPLES:
"linkage arm 6 inches long, 0.5 inch wide, 1/4 inch holes at each end"
→ shape:LINKAGE, widthInches:0.5, depthInches:0.25, shaftLengthInches:6, holeRadiusInches:0.125

"M8 hex nut"
→ shape:HEX_NUT, widthInches:0.5, depthInches:0.25, holeRadiusInches:0.156

"4-inch pipe flange with 4 bolt holes"
→ shape:FLANGE, radiusInches:2, holeRadiusInches:0.25, numHoles:4, flangeWidthInches:3

"L-bracket 2 by 2 by 4 inches"
→ shape:L_BRACKET, widthInches:2, heightInches:2, depthInches:4, wallThicknessInches:0.25

"bushing 1 inch OD, 0.625 inch ID, 1.5 inch long"
→ shape:BUSHING, radiusInches:0.5, holeRadiusInches:0.3125, depthInches:1.5

"cube 2 inches"
→ shape:BOX, widthInches:2, heightInches:2, depthInches:2

"triangular prism"
→ shape:POLYGON, sides:3, radiusInches:1, depthInches:2
`
    },
    { role: "user", content: prompt.trim() }
  ]);

  try {
    const d = JSON.parse(stripJson(raw));
    return {
      featureName:          String(d.featureName          ?? "aiShape").replace(/[^a-zA-Z0-9_]/g, ""),
      featureLabel:         String(d.featureLabel         ?? "AI Shape"),
      shape:                String(d.shape                ?? "BOX"),
      widthInches:          Number(d.widthInches)         || 2,
      heightInches:         Number(d.heightInches)        || 2,
      depthInches:          Number(d.depthInches)         || 2,
      radiusInches:         Number(d.radiusInches)        || 1,
      holeRadiusInches:     Number(d.holeRadiusInches)    || 0,
      filletRadiusInches:   Number(d.filletRadiusInches)  || 0,
      chamferInches:        Number(d.chamferInches)       || 0,
      sides:                Number(d.sides)               || 6,
      wallThicknessInches:  Number(d.wallThicknessInches) || 0.25,
      flangeWidthInches:    Number(d.flangeWidthInches)   || 0.5,
      shaftLengthInches:    Number(d.shaftLengthInches)   || 4,
      nutWidthInches:       Number(d.nutWidthInches)      || 0.75,
      holeSpacingInches:    Number(d.holeSpacingInches)   || 1.5,
      numHoles:             Number(d.numHoles)            || 4,
    };
  } catch {
    console.warn("[AI] Dim extraction failed, using box defaults.");
    return {
      featureName: "simpleCube", featureLabel: "Simple Cube", shape: "BOX",
      widthInches: 2, heightInches: 2, depthInches: 2,
      radiusInches: 1, holeRadiusInches: 0, filletRadiusInches: 0,
      chamferInches: 0, sides: 6, wallThicknessInches: 0.25,
      flangeWidthInches: 0.5, shaftLengthInches: 4, holeSpacingInches: 1.5, numHoles: 4,
    };
  }
}

// ─── Stage 2: Hand-verified FeatureScript templates ────────────────────────────
// AI never touches this section. All FeatureScript is assembled from
// verified patterns — no hallucinations possible.

function n(x)   { return parseFloat(Number(x).toFixed(6)).toString(); }
function fs(x)  { return `${n(x)} * inch`; }

// Standard precondition: user picks any planar face or the default origin planes
function preconditionBlock() {
  return `    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
    }`;
}

// Resolve sketch plane from user selection (falls back to XY origin if nothing selected)
function planeSetup() {
  return `        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });`;
}

// ── BOX ───────────────────────────────────────────────────────────────────────
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

// ── CYLINDER ──────────────────────────────────────────────────────────────────
function templateCylinder(d) {
  return `${planeSetup()}

        opCylinder(context, id + "cyl1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * ${fs(d.depthInches)},
            "radius"        : ${fs(d.radiusInches)},
            "operationType" : NewBodyOperationType.NEW
        });`;
}

// ── PLATE (thin box) ──────────────────────────────────────────────────────────
function templatePlate(d) { return templateBox(d); }

// ── REGULAR POLYGON ───────────────────────────────────────────────────────────
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

// ── LINKAGE ARM ───────────────────────────────────────────────────────────────
// Rectangular bar with a circular hole centred at each end.
// shaftLengthInches = total length, widthInches = bar width,
// depthInches = thickness, holeRadiusInches = pin hole radius.
function templateLinkage(d) {
  const L  = d.shaftLengthInches || d.widthInches * 3;
  const W  = d.widthInches;
  const T  = d.depthInches;
  const R  = d.holeRadiusInches > 0 ? d.holeRadiusInches : W * 0.2;
  // Hole centres sit inward by one pin-hole diameter from each end
  const hx = L / 2 - R * 2;

  return `${planeSetup()}

        // ── Outer body ──
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "body", {
            "firstCorner"  : vector(${n(-L/2)}, ${n(-W/2)}) * inch,
            "secondCorner" : vector(${n(L/2)},  ${n(W/2)})  * inch
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });

        // ── Pin holes ──
        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });
        skCircle(sketch2, "hole1", { "center" : vector(${n(-hx)}, 0) * inch, "radius" : ${fs(R)} });
        skCircle(sketch2, "hole2", { "center" : vector(${n( hx)}, 0) * inch, "radius" : ${fs(R)} });
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(T)},
            "operationType" : NewBodyOperationType.REMOVE
        });${d.filletRadiusInches > 0 ? filletBlock("extrude1", d.filletRadiusInches) : ""}`;
}

// ── PLATE WITH HOLES ──────────────────────────────────────────────────────────
function templatePlateHoles(d) {
  const hw = d.widthInches / 2, hh = d.heightInches / 2;
  const n2 = d.numHoles || 4;
  const sp = d.holeSpacingInches || d.widthInches / (n2 + 1);
  const r  = d.holeRadiusInches  || 0.2;

  // Place holes in a single row along the length
  let holeCode = "";
  for (let i = 0; i < n2; i++) {
    const x = -((n2 - 1) * sp) / 2 + i * sp;
    holeCode += `\n        skCircle(sketch2, "hole${i+1}", { "center" : vector(${n(x)}, 0) * inch, "radius" : ${fs(r)} });`;
  }

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "plate", {
            "firstCorner"  : vector(${n(-hw)}, ${n(-hh)}) * inch,
            "secondCorner" : vector(${n(hw)},  ${n(hh)})  * inch
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });

        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });${holeCode}
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(d.depthInches)},
            "operationType" : NewBodyOperationType.REMOVE
        });`;
}

// ── L-BRACKET ─────────────────────────────────────────────────────────────────
function templateLBracket(d) {
  const L  = d.depthInches;
  const W  = d.widthInches;
  const H  = d.heightInches;
  const T  = d.wallThicknessInches;

  // L profile: two rectangles sharing a corner
  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        // Horizontal leg
        skLineSegment(sketch1, "h1", { "start" : vector(0, 0) * inch,    "end" : vector(${n(W)}, 0) * inch });
        skLineSegment(sketch1, "h2", { "start" : vector(${n(W)}, 0) * inch, "end" : vector(${n(W)}, ${n(T)}) * inch });
        skLineSegment(sketch1, "h3", { "start" : vector(${n(W)}, ${n(T)}) * inch, "end" : vector(${n(T)}, ${n(T)}) * inch });
        // Vertical leg
        skLineSegment(sketch1, "v1", { "start" : vector(${n(T)}, ${n(T)}) * inch, "end" : vector(${n(T)}, ${n(H)}) * inch });
        skLineSegment(sketch1, "v2", { "start" : vector(${n(T)}, ${n(H)}) * inch, "end" : vector(0, ${n(H)}) * inch });
        skLineSegment(sketch1, "v3", { "start" : vector(0, ${n(H)}) * inch,       "end" : vector(0, 0) * inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(L)}
        });${d.filletRadiusInches > 0 ? filletBlock("extrude1", d.filletRadiusInches) : ""}`;
}

// ── U-CHANNEL ─────────────────────────────────────────────────────────────────
function templateUChannel(d) {
  const W = d.widthInches;
  const H = d.heightInches;
  const T = d.wallThicknessInches;
  const L = d.depthInches;

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skLineSegment(sketch1, "l1", { "start" : vector(0, 0) * inch,       "end" : vector(${n(W)}, 0) * inch });
        skLineSegment(sketch1, "l2", { "start" : vector(${n(W)}, 0) * inch,       "end" : vector(${n(W)}, ${n(H)}) * inch });
        skLineSegment(sketch1, "l3", { "start" : vector(${n(W)}, ${n(H)}) * inch, "end" : vector(${n(W-T)}, ${n(H)}) * inch });
        skLineSegment(sketch1, "l4", { "start" : vector(${n(W-T)}, ${n(H)}) * inch, "end" : vector(${n(W-T)}, ${n(T)}) * inch });
        skLineSegment(sketch1, "l5", { "start" : vector(${n(W-T)}, ${n(T)}) * inch, "end" : vector(${n(T)}, ${n(T)}) * inch });
        skLineSegment(sketch1, "l6", { "start" : vector(${n(T)}, ${n(T)}) * inch, "end" : vector(${n(T)}, ${n(H)}) * inch });
        skLineSegment(sketch1, "l7", { "start" : vector(${n(T)}, ${n(H)}) * inch,  "end" : vector(0, ${n(H)}) * inch });
        skLineSegment(sketch1, "l8", { "start" : vector(0, ${n(H)}) * inch,         "end" : vector(0, 0) * inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(L)}
        });`;
}

// ── FLANGE ────────────────────────────────────────────────────────────────────
function templateFlange(d) {
  const R    = d.radiusInches;
  const bR   = d.holeRadiusInches  || 0.25;   // bolt hole radius
  const cR   = bR * 2;                          // central bore radius
  const boltR = R * 0.75;                        // bolt circle radius
  const num  = Math.max(2, Math.round(d.numHoles || 4));
  const T    = d.depthInches || 0.5;

  let boltHoles = "";
  for (let i = 0; i < num; i++) {
    const ang = (2 * Math.PI * i) / num;
    const bx  = boltR * Math.cos(ang);
    const by  = boltR * Math.sin(ang);
    boltHoles += `\n        skCircle(sketch2, "bh${i+1}", { "center" : vector(${n(bx)}, ${n(by)}) * inch, "radius" : ${fs(bR)} });`;
  }

  return `${planeSetup()}

        // Outer disk
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "disk", { "center" : vector(0, 0) * inch, "radius" : ${fs(R)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });

        // Central bore + bolt holes
        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });
        skCircle(sketch2, "bore", { "center" : vector(0, 0) * inch, "radius" : ${fs(cR)} });${boltHoles}
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(T)},
            "operationType" : NewBodyOperationType.REMOVE
        });`;
}

// ── HEX NUT ───────────────────────────────────────────────────────────────────
function templateHexNut(d) {
  const W = d.nutWidthInches  || d.widthInches;   // across-flats
  const T = d.depthInches;
  const r = (W / Math.sqrt(3));                    // circumradius from across-flats
  const hR = d.holeRadiusInches || W * 0.22;

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "hex", {
            "center"      : vector(0, 0) * inch,
            "firstVertex" : vector(${n(r)}, 0) * inch,
            "sides"       : 6
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });

        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });
        skCircle(sketch2, "bore", { "center" : vector(0, 0) * inch, "radius" : ${fs(hR)} });
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(T)},
            "operationType" : NewBodyOperationType.REMOVE
        });`;
}

// ── WASHER ────────────────────────────────────────────────────────────────────
function templateWasher(d) {
  const R  = d.radiusInches;
  const hR = d.holeRadiusInches || R * 0.4;
  const T  = d.depthInches || 0.1;

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : ${fs(R)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });

        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });
        skCircle(sketch2, "bore", { "center" : vector(0, 0) * inch, "radius" : ${fs(hR)} });
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(T)},
            "operationType" : NewBodyOperationType.REMOVE
        });`;
}

// ── BUSHING (hollow cylinder) ─────────────────────────────────────────────────
function templateBushing(d) {
  const R  = d.radiusInches;
  const hR = d.holeRadiusInches || R * 0.6;
  const T  = d.depthInches;

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0, 0) * inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "bore",  { "center" : vector(0, 0) * inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });`;
}

// ── STEPPED SHAFT ─────────────────────────────────────────────────────────────
function templateSteppedShaft(d) {
  const R1 = d.radiusInches;
  const R2 = R1 * 0.6;
  const L1 = d.depthInches * 0.5;
  const L2 = d.depthInches * 0.5;

  return `${planeSetup()}

        // Large section
        opCylinder(context, id + "cyl1", {
            "bottomCenter"  : skPlane.origin,
            "topCenter"     : skPlane.origin + skPlane.normal * ${fs(L1)},
            "radius"        : ${fs(R1)},
            "operationType" : NewBodyOperationType.NEW
        });

        // Small section (shifted along normal)
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

// ── BOX WITH HOLE (generic) ───────────────────────────────────────────────────
function templateBoxWithHole(d) {
  const hw = d.widthInches / 2, hh = d.heightInches / 2;

  return `${planeSetup()}

        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "rect1", {
            "firstCorner"  : vector(${n(-hw)}, ${n(-hh)}) * inch,
            "secondCorner" : vector(${n(hw)},  ${n(hh)})  * inch
        });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(d.depthInches)}
        });

        var sketch2 = newSketchOnPlane(context, id + "sketch2", { "sketchPlane" : skPlane });
        skCircle(sketch2, "hole1", { "center" : vector(0, 0) * inch, "radius" : ${fs(d.holeRadiusInches)} });
        skSolve(sketch2);
        opExtrude(context, id + "holeCut1", {
            "entities"      : qSketchRegion(id + "sketch2"),
            "direction"     : skPlane.normal,
            "endBound"      : BoundingType.BLIND,
            "endDepth"      : ${fs(d.depthInches)},
            "operationType" : NewBodyOperationType.REMOVE
        });`;
}

// ── Shared fillet/chamfer helpers ─────────────────────────────────────────────
function filletBlock(extId, r) {
  return `

        opFillet(context, id + "fillet1", {
            "entities" : qEdgeTopologyFilter(
                             qOwnedByBody(qCreatedBy(id + "${extId}", EntityType.BODY), EntityType.EDGE),
                             EdgeTopology.TWO_SIDED),
            "radius"   : ${fs(r)}
        });`;
}

function chamferBlock(extId, w) {
  return `

        opChamfer(context, id + "chamfer1", {
            "entities" : qEdgeTopologyFilter(
                             qOwnedByBody(qCreatedBy(id + "${extId}", EntityType.BODY), EntityType.EDGE),
                             EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width"       : ${fs(w)}
        });`;
}

// ─── Assemble ─────────────────────────────────────────────────────────────────

function buildFeatureScript(d) {
  let bodyContent;

  // Route to correct template
  if (d.holeRadiusInches > 0 && !["LINKAGE","PLATE_HOLES","FLANGE","HEX_NUT","WASHER","BUSHING"].includes(d.shape)) {
    bodyContent = templateBoxWithHole(d);
  } else {
    switch (d.shape) {
      case "CYLINDER":      bodyContent = templateCylinder(d);     break;
      case "PLATE":         bodyContent = templatePlate(d);        break;
      case "POLYGON":       bodyContent = templatePolygon(d);      break;
      case "LINKAGE":       bodyContent = templateLinkage(d);      break;
      case "PLATE_HOLES":   bodyContent = templatePlateHoles(d);   break;
      case "L_BRACKET":     bodyContent = templateLBracket(d);     break;
      case "T_BRACKET":     bodyContent = templateLBracket(d);     break; // close enough
      case "U_CHANNEL":     bodyContent = templateUChannel(d);     break;
      case "FLANGE":        bodyContent = templateFlange(d);       break;
      case "HEX_NUT":       bodyContent = templateHexNut(d);       break;
      case "WASHER":        bodyContent = templateWasher(d);       break;
      case "BUSHING":       bodyContent = templateBushing(d);      break;
      case "STEPPED_SHAFT": bodyContent = templateSteppedShaft(d); break;
      case "GEAR_BLANK":    bodyContent = templateCylinder(d);     break;
      default:              bodyContent = templateBox(d);          break;
    }
  }

  const name  = (d.featureName  || "aiShape").replace(/[^a-zA-Z0-9_]/g, "");
  const label = (d.featureLabel || "AI Shape").replace(/"/g, "'");

  return `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "${label}" }
export const ${name} = defineFeature(function(context is Context, id is Id, definition is map)
${preconditionBlock()}
    {
${bodyContent}
    });
`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(code) {
  const issues = [];
  if (/\*\s*inch\s*\*\s*inch/.test(code))    issues.push("double * inch");
  if (/qOriginPlane/.test(code))              issues.push("qOriginPlane");
  if (/\bPlane\.[XYZ]/.test(code))           issues.push("Plane.XY/XZ");
  if (/\bskPolygon\b/.test(code))             issues.push("skPolygon (invalid)");
  if (!code.includes("GeometryType.PLANE"))   issues.push("missing GeometryType.PLANE");
  if (!code.includes("newSketchOnPlane"))     issues.push("newSketch instead of newSketchOnPlane");
  const exports = (code.match(/\bexport const\b/g) || []).length;
  if (exports !== 1) issues.push(`${exports} export const`);
  if (issues.length) console.warn("[AI] Validation issues:", issues.join(" | "));
  else               console.log("[AI] ✓ Validation passed.");
  return issues;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");
  if (!prompt?.trim())           throw new Error("Empty prompt");

  console.log("[AI] Stage 1: Extracting shape + dimensions...");
  const dims = await extractDims(prompt);
  console.log(`[AI] Shape=${dims.shape} | w=${dims.widthInches} h=${dims.heightInches} d=${dims.depthInches} r=${dims.radiusInches} hole=${dims.holeRadiusInches}`);

  console.log("[AI] Stage 2: Building FeatureScript from template...");
  const code = buildFeatureScript(dims);

  validate(code);
  console.log(`[AI] ✓ Output: ${code.length} chars`);
  return code;
}