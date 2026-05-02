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

// ─── FeatureScript value helpers ──────────────────────────────────────────────

function n(x)  { return parseFloat(Number(x).toFixed(6)).toString(); }
function fs(x) { return `${n(x)} * inch`; }

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

function filletBlock(ref, r) {
  return `\n        opFillet(context, id + "fillet1", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "${ref}", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius"   : ${fs(r)}
        });`;
}

function chamferBlock(ref, w) {
  return `\n        opChamfer(context, id + "chamfer1", {
            "entities"    : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "${ref}", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width"       : ${fs(w)}
        });`;
}

// ─── Shape templates ──────────────────────────────────────────────────────────

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
  const hw = L / 2, hh = W / 2;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRectangle(sketch1, "body", {
            "firstCorner"  : vector(${n(-hw)}, ${n(-hh)}) * inch,
            "secondCorner" : vector(${n(hw)},  ${n(hh)})  * inch
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
  const L = d.depthInches, W = d.widthInches, H = d.heightInches, T = d.wallThicknessInches;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skLineSegment(sketch1, "h1", { "start" : vector(0,0)*inch,               "end" : vector(${n(W)},0)*inch });
        skLineSegment(sketch1, "h2", { "start" : vector(${n(W)},0)*inch,         "end" : vector(${n(W)},${n(T)})*inch });
        skLineSegment(sketch1, "h3", { "start" : vector(${n(W)},${n(T)})*inch,   "end" : vector(${n(T)},${n(T)})*inch });
        skLineSegment(sketch1, "v1", { "start" : vector(${n(T)},${n(T)})*inch,   "end" : vector(${n(T)},${n(H)})*inch });
        skLineSegment(sketch1, "v2", { "start" : vector(${n(T)},${n(H)})*inch,   "end" : vector(0,${n(H)})*inch });
        skLineSegment(sketch1, "v3", { "start" : vector(0,${n(H)})*inch,          "end" : vector(0,0)*inch });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(L)}
        });${d.filletRadiusInches > 0 ? filletBlock("extrude1", d.filletRadiusInches) : ""}`;
}

function templateFlange(d) {
  const R = d.radiusInches, bR = d.holeRadiusInches || 0.25;
  const cR = bR * 2, boltR = R * 0.75;
  const num = Math.max(2, Math.round(d.numHoles || 4));
  let holes = `\n        skCircle(sketch1, "bore", { "center" : vector(0,0)*inch, "radius" : ${fs(cR)} });`;
  for (let i = 0; i < num; i++) {
    const ang = (2 * Math.PI * i) / num;
    holes += `\n        skCircle(sketch1, "bh${i+1}", { "center" : vector(${n(boltR*Math.cos(ang))},${n(boltR*Math.sin(ang))})*inch, "radius" : ${fs(bR)} });`;
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
  const W = d.widthInches, T = d.depthInches, r = W / Math.sqrt(3);
  const hR = d.holeRadiusInches || W * 0.22;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skRegularPolygon(sketch1, "hex", { "center" : vector(0,0)*inch, "firstVertex" : vector(${n(r)},0)*inch, "sides" : 6 });
        skCircle(sketch1, "bore", { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });`;
}

function templateWasher(d) {
  const R = d.radiusInches, hR = d.holeRadiusInches || R * 0.4, T = d.depthInches || 0.1;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0,0)*inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "bore",  { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
        });`;
}

function templateBushing(d) {
  const R = d.radiusInches, hR = d.holeRadiusInches || R * 0.6, T = d.depthInches;
  return `${planeSetup()}
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });
        skCircle(sketch1, "outer", { "center" : vector(0,0)*inch, "radius" : ${fs(R)} });
        skCircle(sketch1, "bore",  { "center" : vector(0,0)*inch, "radius" : ${fs(hR)} });
        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities"  : qSketchRegion(id + "sketch1", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : ${fs(T)}
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
  if (d.holeRadiusInches > 0 && !holeSafe.includes(d.shape)) body = templateBoxWithHole(d);
  else switch (d.shape) {
    case "CYLINDER":    body = templateCylinder(d);   break;
    case "PLATE":       body = templateBox(d);        break;
    case "POLYGON":     body = templatePolygon(d);    break;
    case "LINKAGE":     body = templateLinkage(d);    break;
    case "PLATE_HOLES": body = templatePlateHoles(d); break;
    case "L_BRACKET":
    case "T_BRACKET":   body = templateLBracket(d);   break;
    case "FLANGE":      body = templateFlange(d);     break;
    case "HEX_NUT":     body = templateHexNut(d);     break;
    case "WASHER":      body = templateWasher(d);     break;
    case "BUSHING":     body = templateBushing(d);    break;
    default:            body = templateBox(d);        break;
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

// ─── Dimension extractor ──────────────────────────────────────────────────────

const DIM_SYSTEM = `You are a mechanical CAD dimension extractor. Output ONLY a valid JSON object. No markdown, no explanation, no extra text.

Schema:
{
  "featureName": "camelCase identifier",
  "featureLabel": "Human readable name",
  "shape": "BOX|CYLINDER|PLATE|POLYGON|LINKAGE|PLATE_HOLES|L_BRACKET|T_BRACKET|FLANGE|HEX_NUT|WASHER|BUSHING",
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

Shape classification — read carefully before choosing:

BOX          — cube, block, rectangular solid, billet, slab with no holes
CYLINDER     — cylinder, rod, shaft, tube (solid), dowel, pin, post, standoff, barrel, drum, peg, boss
PLATE        — flat plate, sheet, panel, card, tile, no holes (use PLATE_HOLES if it has holes)
POLYGON      — triangle, pentagon, hexagon, octagon, N-sided prism; use sides field
LINKAGE      — connecting rod, linkage arm, link bar, rocker arm, crank arm, pitman arm, tie rod,
               coupler, push rod, clevis rod, train link, drive rod, motion link, lever arm;
               any elongated bar with a pin hole at each end
PLATE_HOLES  — mounting plate, bracket face, gusset, pattern plate; flat rectangle with multiple holes
L_BRACKET    — L-bracket, angle bracket, shelf bracket, corner bracket, right-angle bracket
T_BRACKET    — T-bracket, T-plate (uses same template as L_BRACKET)
FLANGE       — pipe flange, weld flange, bolt flange, circular plate with bolt circle
HEX_NUT      — hex nut, jam nut, lock nut, nut
WASHER       — washer, spacer disk, shim, flat ring
BUSHING      — bushing, sleeve, hollow tube, liner, journal bearing, boss with through-hole

Dimension rules:
- All output must be in INCHES. Convert mm by dividing by 25.4.
- "diameter X" means radiusInches = X / 2
- "across flats X" (hex) means widthInches = X; the template converts to circumradius automatically
- "OD X ID Y" means radiusInches = X/2, holeRadiusInches = Y/2
- LINKAGE: shaftLengthInches = total length, widthInches = bar width, depthInches = thickness
- PLATE_HOLES: numHoles counts holes; holeSpacingInches is center-to-center spacing
- Any dimension not stated: use a sensible mechanical default (don't output 0 for important dims)
- featureName must be a valid camelCase JS identifier with no spaces or special chars`;

async function extractDims(prompt) {
  const raw = await chat([
    { role: "system", content: DIM_SYSTEM },
    { role: "user",   content: prompt.trim() }
  ]);
  try {
    const d = JSON.parse(stripJson(raw));
    return {
      featureName:         String(d.featureName         ?? "aiShape").replace(/[^a-zA-Z0-9_]/g,""),
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
    return { featureName:"simpleCube", featureLabel:"Simple Cube", shape:"BOX",
             widthInches:2, heightInches:2, depthInches:2, radiusInches:1,
             holeRadiusInches:0, filletRadiusInches:0, chamferInches:0,
             sides:6, wallThicknessInches:0.25, shaftLengthInches:4,
             holeSpacingInches:1.5, numHoles:4 };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Generating: "${prompt}"`);
  const dims = await extractDims(prompt);
  console.log(`[AI] shape=${dims.shape} w=${dims.widthInches} h=${dims.heightInches} d=${dims.depthInches} L=${dims.shaftLengthInches}`);
  const code = buildFeatureScript(dims);
  console.log(`[AI] done — ${code.length} chars`);
  return { code, featureName: dims.featureName, featureLabel: dims.featureLabel };
}

export async function debugFeatureScript(code, errors) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Debugging FeatureScript (${code.length} chars)`);

  const raw = await chat([
    {
      role: "system",
      content: `You are an Onshape FeatureScript debugger. The user gives you broken FeatureScript and error messages.

Return ONLY a JSON object:
{ "explanation": "plain English — what was wrong and what you changed",
  "fixed": "the complete corrected FeatureScript with no markdown and no backticks" }

Common fixes to apply:
- NUMBER * inch * inch → NUMBER * inch
- qOriginPlane(context, Plane.XY) → plane(WORLD_ORIGIN, Z_DIRECTION)
- evPlane(...).normal used as sketch plane → assign evPlane to variable first, use variable.normal
- skPolygon → skRegularPolygon
- isLength / isBoolean in feature body → move into precondition or remove
- Missing skSolve() → add after last sketch entity, before opExtrude
- Multiple export const blocks → keep only the last
- return statement in body → delete
- Raw number for geometry dimension → add * inch`
    },
    { role: "user", content: `FEATURESCRIPT:\n${code}\n\nERRORS:\n${errors}` }
  ]);

  try {
    const parsed = JSON.parse(stripJson(raw));
    const fixed = (parsed.fixed || code).replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed, explanation: parsed.explanation || "Fixed." };
  } catch {
    const cleaned = raw.replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed: cleaned || code, explanation: "Could not parse the fix response — raw output returned." };
  }
}

export async function analyzeImage(imageBase64, mimeType, extraPrompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Analyzing image (${mimeType})`);

  const descRaw = await chat([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        {
          type: "text",
          text: `You are a mechanical CAD engineer. Examine this image of a part or CAD model.
${extraPrompt ? `User note: "${extraPrompt}"` : ""}

Describe the part for a CAD dimension extractor:
- Overall shape category (box, cylinder, L-bracket, linkage arm, flange, etc.)
- Key dimensions in inches where estimable
- Presence of holes, fillets, chamfers and their approximate sizes
- Mechanical function of the part

Be specific. Plain text only, no lists, no headers.`
        }
      ]
    }
  ], VISION_MODEL);

  console.log(`[AI] Image description: ${descRaw.slice(0, 100)}...`);

  const combinedPrompt = extraPrompt ? `${extraPrompt}. Based on image: ${descRaw}` : descRaw;
  const { code, featureName, featureLabel } = await generateFeatureScript(combinedPrompt);
  return { description: descRaw, code, featureName, featureLabel };
}