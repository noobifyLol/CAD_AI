import Groq from "groq-sdk";

const groq        = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL  = process.env.GROQ_MODEL        || "llama-3.3-70b-versatile";
const VISION_MODEL= process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages, model = TEXT_MODEL) {
  const res = await groq.chat.completions.create({ model, temperature: 0.0, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

// ─── FeatureScript helpers ─────────────────────────────────────────────────────

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

// ─── Templates ────────────────────────────────────────────────────────────────

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

// One sketch with rectangle + two circles = single solid with holes (no boolean needed)
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
  const hw = d.widthInches / 2, hh = d.heightInches / 2;
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

// ─── Assemble full file ───────────────────────────────────────────────────────

function buildFeatureScript(d) {
  const holeSafe = ["LINKAGE","PLATE_HOLES","FLANGE","HEX_NUT","WASHER","BUSHING"];
  let body;
  if (d.holeRadiusInches > 0 && !holeSafe.includes(d.shape)) body = templateBoxWithHole(d);
  else switch (d.shape) {
    case "CYLINDER":      body = templateCylinder(d);   break;
    case "PLATE":         body = templateBox(d);        break;
    case "POLYGON":       body = templatePolygon(d);    break;
    case "LINKAGE":       body = templateLinkage(d);    break;
    case "PLATE_HOLES":   body = templatePlateHoles(d); break;
    case "L_BRACKET":
    case "T_BRACKET":     body = templateLBracket(d);   break;
    case "FLANGE":        body = templateFlange(d);     break;
    case "HEX_NUT":       body = templateHexNut(d);     break;
    case "WASHER":        body = templateWasher(d);     break;
    case "BUSHING":       body = templateBushing(d);    break;
    default:              body = templateBox(d);        break;
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

// ─── Dim extractor (Stage 1) ──────────────────────────────────────────────────

const DIM_SYSTEM = `You are a CAD dimension extractor. Output ONLY valid JSON. No markdown. No explanation.

OUTPUT SCHEMA:
{
  "featureName": "camelCase",
  "featureLabel": "Human Name",
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

SHAPE GUIDE:
box/cube/block            → BOX
cylinder/rod/shaft/tube   → CYLINDER
flat plate/sheet/panel    → PLATE
triangle(3)/hex(6)/N-gon  → POLYGON + sides
connecting rod/linkage/crank arm/tie rod/rocker → LINKAGE
mounting plate with holes → PLATE_HOLES
L-bracket/shelf bracket   → L_BRACKET
pipe flange/weld flange   → FLANGE
hex nut                   → HEX_NUT
washer/spacer disk        → WASHER
bushing/sleeve/hollow tube→ BUSHING

LINKAGE: widthInches=bar width, shaftLengthInches=total length, depthInches=thickness, holeRadiusInches=pin hole r
All dims in INCHES. "mm" ÷ 25.4. "diameter X" → radiusInches=X/2. Missing → sensible default.`;

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
             sides:6, wallThicknessInches:0.25, shaftLengthInches:4, holeSpacingInches:1.5, numHoles:4 };
  }
}

// ─── Public: Generate ─────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Generating for: "${prompt}"`);
  const dims = await extractDims(prompt);
  console.log(`[AI] Shape=${dims.shape} w=${dims.widthInches} h=${dims.heightInches} d=${dims.depthInches} L=${dims.shaftLengthInches}`);
  const code = buildFeatureScript(dims);
  console.log(`[AI] ✓ ${code.length} chars`);
  return { code, featureName: dims.featureName, featureLabel: dims.featureLabel };
}

// ─── Public: Debug ────────────────────────────────────────────────────────────
// Takes broken FeatureScript + error text → returns fixed code + plain-English explanation

export async function debugFeatureScript(code, errors) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Debugging FeatureScript (${code.length} chars)...`);

  const raw = await chat([
    {
      role: "system",
      content: `You are an Onshape FeatureScript debugger.
The user will give you broken FeatureScript code and the error messages.
You must:
1. Identify every error.
2. Fix the code.
3. Return ONLY a JSON object with two fields:
   { "explanation": "plain English summary of what was wrong and what you fixed",
     "fixed": "the complete corrected FeatureScript, no markdown, no backticks" }

COMMON FIXES:
- "* inch * inch" → "* inch"  (double unit)
- qOriginPlane(context, Plane.XY) → plane(WORLD_ORIGIN, Z_DIRECTION)
- evPlane(...).normal in sketch → just use Z_DIRECTION or skPlane.normal
- skPolygon → skRegularPolygon
- isLength/isBoolean in feature body → move into precondition or delete
- Missing skSolve() → add after last sketch entity
- Two export const → keep only the last one
- Return statement in body → delete it
- Bare number "endDepth": 2 → "endDepth": 2 * inch`
    },
    {
      role: "user",
      content: `FEATURESCRIPT:\n${code}\n\nERRORS:\n${errors}`
    }
  ]);

  try {
    const parsed = JSON.parse(stripJson(raw));
    // Strip any accidental fences from the fixed code
    const fixed = (parsed.fixed || code).replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed, explanation: parsed.explanation || "Fixed." };
  } catch {
    // If JSON parse fails, return the raw text as both fields
    const cleaned = raw.replace(/^```[\w]*\n?/gm, "").replace(/^```$/gm, "").trim();
    return { fixed: cleaned || code, explanation: "Could not fully parse the fix — here is the raw output." };
  }
}

// ─── Public: Analyze Image ────────────────────────────────────────────────────
// Takes a base64 image → describes the part → generates FeatureScript for it

export async function analyzeImage(imageBase64, mimeType, extraPrompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY not set in .env");
  console.log(`[AI] Analyzing image (${mimeType})...`);

  // Step 1: Vision model describes the part
  const descRaw = await chat([
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${imageBase64}` }
        },
        {
          type: "text",
          text: `You are a CAD engineer. Look at this image of a mechanical part or CAD model.
${extraPrompt ? `Additional context from user: "${extraPrompt}"` : ""}

Describe the part in detail for a CAD system:
- What is the shape? (box, cylinder, L-bracket, linkage arm, flange, etc.)
- What are the approximate dimensions? (in inches if you can estimate)
- Are there holes? Fillets? Chamfers?
- What mechanical purpose does this part serve?

Be specific and concise. Output plain text only.`
        }
      ]
    }
  ], VISION_MODEL);

  console.log(`[AI] Image description: ${descRaw.slice(0, 120)}...`);

  // Step 2: Use description + extra prompt to generate FeatureScript
  const combinedPrompt = extraPrompt
    ? `${extraPrompt}. Based on this image: ${descRaw}`
    : descRaw;

  const { code, featureName, featureLabel } = await generateFeatureScript(combinedPrompt);

  return { description: descRaw, code, featureName, featureLabel };
}