import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTIVE_NETWORK_KEY,
  createInitialAdaptiveState,
  feedbackStrength,
  feedbackTarget,
  rerankCandidates,
  trainAdaptiveState,
} from "./adaptiveNetwork.js";
import {
  dedupeSeedEntries,
  loadSeedEntriesFromCsv,
  loadSeedEntriesFromJson,
} from "./scripts/lib/cadSeedData.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MISSING_DB_CODES = new Set(["42P01", "PGRST116", "PGRST202", "PGRST205", "42883"]);
const REQUIRED_ADAPTIVE_TABLES = [
  "cad_knowledge",
  "cad_memory",
  "cad_generation_memory_matches",
  "cad_feedback_events",
  "cad_memory_pruning_events",
  "cad_learning_state",
];

// ─── Small utilities ──────────────────────────────────────────────────────────

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function warnOnce(seen, key, message) {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(message);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function isMissingDbObject(error) {
  return MISSING_DB_CODES.has(error?.code);
}

function toFsPath(value) {
  if (!value) return null;
  return value instanceof URL ? fileURLToPath(value) : String(value);
}

function clampQualityScore(value, fallback = 0.55) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function safeTextArray(value, limit = 8) {
  return (Array.isArray(value) ? value : [])
    .map(item => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function feedbackCountersForWeight(weight) {
  return {
    successDelta: weight > 0 ? 1 : 0,
    failureDelta: weight < 0 ? 1 : 0,
  };
}

// ─── DB result helpers ────────────────────────────────────────────────────────

function dbLogResult({
  id = null, ok = false, skipped = false, error = null,
  code = null, table = null, action = null,
  createdAt = new Date().toISOString(), details = null,
} = {}) {
  return { id, ok, skipped, error, code, table, action, createdAt, details };
}

function dbErrorResult(table, action, error) {
  return dbLogResult({
    ok: false, table, action,
    error: error?.message || String(error || "Unknown database error"),
    code: error?.code || null,
  });
}

// ─── Local file loaders ───────────────────────────────────────────────────────

function loadOptionalCsv(pathOrUrl, options = {}) {
  const filePath = toFsPath(pathOrUrl);
  if (!filePath || !existsSync(filePath)) return [];
  return loadSeedEntriesFromCsv(filePath, options);
}

function loadOptionalJson(pathOrUrl, options = {}) {
  const filePath = toFsPath(pathOrUrl);
  if (!filePath || !existsSync(filePath)) return [];
  return loadSeedEntriesFromJson(filePath, options);
}

function siblingPath(pathOrUrl, fileName) {
  const filePath = toFsPath(pathOrUrl);
  return filePath ? join(dirname(filePath), fileName) : null;
}



// ─── Adaptive state ───────────────────────────────────────────────────────────

function loadLocalAdaptiveStateFile() {
  const statePath = fileURLToPath(new URL("./data/adaptive_state.json", import.meta.url));
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    return parsed?.state || parsed;
  } catch (err) {
    console.warn(`[Learning] Could not read local adaptive state: ${err.message}`);
    return null;
  }
}

// ─── FS docs indexer ──────────────────────────────────────────────────────────
// Chunks local markdown docs into retrievable snippets for AI context.
// Each chunk is tagged with FS operations it covers for prompt-aware routing.

// Operation keyword groups — maps a prompt theme to FS operations to prioritize
const FS_OPERATION_GROUPS = {
  sketch:    ["newsketchonplane", "newsketch", "sksolve", "skcircle", "skrectangle", "sklinesgement", "skfitspline", "skregularpolygon", "skarc", "qsketchregion"],
  extrude:   ["opextrude", "boundingtype", "blind", "qsketchregion", "sksolve"],
  revolve:   ["oprevolve", "angleforward", "radian", "line(", "cross(", "skfitspline"],
  loft:      ["oploft", "profilesubqueries", "qsketchregion", "newsketchonplane"],
  sweep:     ["opsweep", "profiles", "path", "qcreatedby", "entitytype.edge"],
  shell:     ["opshell", "capentity", "captype", "thickness"],
  fillet:    ["opfillet", "radius", "qedgetopologyfilter", "edgetopology.two_sided"],
  chamfer:   ["opchamfer", "chamfertype", "equal_offsets", "width"],
  boolean:   ["opboolean", "booleanoperationtype", "union", "subtraction", "tools", "targets"],
  cylinder:  ["opcylinder", "bottomcenter", "topcenter", "newbodyoperationtype"],
  pattern:   ["oppattern", "transform", "qcreatedby"],
  gear:      ["skfitspline", "skarc", "cos(", "sin(", "sqrt(", "atan2", "pi", "involute", "pressurea"],
  precondition: ["islength", "isinteger", "length_bounds", "nonnegative", "query", "geomtype", "filter"],
  lambda:    ["const", "function(", "definefeature", "precondition", "context is context", "id is id"],
  units:     ["inch", "valueWithUnits", "meter", "degree", "radian", "unitless"],
};

// Canonical high-quality FS operation snippets from official Onshape documentation.
// These are used as permanent context when local .md doc files are missing or sparse.
// Sources: https://cad.onshape.com/FsDoc/library.html, https://cad.onshape.com/FsDoc/index.html
const FS_BUILTIN_SNIPPETS = [
  {
    title: "FeatureScript feature structure and precondition",
    source: "builtin:official_docs",
    operations: ["definefeature", "precondition", "islength", "isinteger"],
    text: `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "My Feature" }
export const myFeature = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        // User-selectable plane
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        // Length parameter — isLength gives the user a slider in the dialog
        annotation { "Name" : "Width", "Default" : "2 * inch" }
        isLength(definition.width, LENGTH_BOUNDS);

        // Integer parameter — FS 2931 REQUIRES the bounds map {(unitless) : [min, default, max]}
        // NEVER write: isInteger(definition.x); or definition.x >= N; definition.x <= N;
        annotation { "Name" : "Count", "Default" : "4" }
        isInteger(definition.count, {(unitless) : [1, 4, 100]});

        // Degrees as integer — convert in body with: definition.angleDeg * PI / 180
        annotation { "Name" : "Pressure Angle", "Default" : "20" }
        isInteger(definition.angleDeg, {(unitless) : [10, 20, 30]});

        // Boolean toggle
        annotation { "Name" : "Add Bore" }
        definition.addBore is boolean;
    }
    {
        // Get sketch plane from user selection
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        // Body of feature here
    });

RULES:
- definition.width already has Length type from isLength() — NEVER write definition.width * inch
- "definition.x is Length" is INVALID — use isLength(definition.x, LENGTH_BOUNDS)
- "definition.x is number" is INVALID — use isInteger(..., {(unitless) : [min, def, max]})
- bare isInteger(definition.x); is INVALID without the bounds map second argument`,
    quality_score: 1.0,
  },
  {
    title: "Sketch creation, entities, and skSolve",
    source: "builtin:official_docs",
    operations: ["newsketchonplane", "sksolve", "skcircle", "skrectangle", "sklinesgement", "skfitspline", "skregularpolygon", "qsketchregion"],
    text: `// Create a sketch on the user-selected plane
var sk = newSketchOnPlane(context, id + "sk1", { "sketchPlane" : skPlane });

// Sketch entities — all coordinates are vector(x, y) * inch
// where x and y are UNITLESS numbers (divide a Length by inch to get a number)
skCircle(sk, "circ1", { "center" : vector(0, 0) * inch, "radius" : definition.radius });
skRectangle(sk, "rect1", {
    "firstCorner"  : vector(-definition.width / inch / 2, -definition.height / inch / 2) * inch,
    "secondCorner" : vector( definition.width / inch / 2,  definition.height / inch / 2) * inch
});
skLineSegment(sk, "line1", { "start" : vector(0, 0) * inch, "end" : vector(1, 0) * definition.length });
skRegularPolygon(sk, "hex1", { "center" : vector(0,0)*inch, "firstVertex" : vector(1,0)*definition.radius, "sides" : 6 });
skFitSpline(sk, "spline1", { "points" : [vector(0,0)*inch, vector(1,0.5)*inch, vector(2,0)*inch] });
skArc(sk, "arc1", { "start" : vector(1,0)*inch, "mid" : vector(0,1)*inch, "end" : vector(-1,0)*inch });

// ALWAYS call skSolve before any opExtrude / opRevolve — without it no geometry appears
skSolve(sk);

// Reference sketch regions — ALWAYS use id expression, NEVER the sketch variable
qSketchRegion(id + "sk1")         // outer region
qSketchRegion(id + "sk1", true)   // inner loops excluded (for tubes, annuli, holes)

RULES:
- "skPolygon" does NOT exist — use skRegularPolygon
- "skSpline" does NOT exist — use skFitSpline
- qSketchRegion(sk) is WRONG — use qSketchRegion(id + "sk1")
- skSolve is mandatory before any downstream solid operation`,
    quality_score: 1.0,
  },
  {
    title: "opExtrude — extruding a solved sketch profile",
    source: "builtin:official_docs",
    operations: ["opextrude", "boundingtype", "blind", "qsketchregion"],
    text: `// Extrude a solved sketch region to create a solid body
opExtrude(context, id + "ext1", {
    "entities"  : qSketchRegion(id + "sk1"),      // the profile to extrude
    "direction" : skPlane.normal,                  // direction vector (not a Query)
    "endBound"  : BoundingType.BLIND,
    "endDepth"  : definition.depth                 // already a Length — never multiply by * inch
});

// Symmetric extrude (both directions)
opExtrude(context, id + "ext1", {
    "entities"    : qSketchRegion(id + "sk1"),
    "direction"   : skPlane.normal,
    "endBound"    : BoundingType.BLIND,
    "endDepth"    : definition.depth / 2,
    "startBound"  : BoundingType.BLIND,
    "startDepth"  : definition.depth / 2
});

// Extrude annulus / tube (inner + outer circles in same sketch)
opExtrude(context, id + "ext1", {
    "entities"  : qSketchRegion(id + "sk1", true), // true = exclude inner loops
    "direction" : skPlane.normal,
    "endBound"  : BoundingType.BLIND,
    "endDepth"  : definition.height
});`,
    quality_score: 0.98,
  },
  {
    title: "opRevolve — revolving a closed profile around an axis",
    source: "builtin:official_docs",
    operations: ["oprevolve", "angleforward", "radian", "line(", "cross("],
    text: `// opRevolve creates a solid of revolution from a closed sketch profile.
// The axis must be a Line value — NOT a Query, NOT qSketchEntity, NOT qCreatedBy.

// Build the axis from the sketch plane geometry
var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
// Or use a named axis line:
var revolveAxis = line(skPlane.origin, skPlane.normal);

// Profile sketch: draw the cross-section on one side of the axis
// The sketch must have a closed region — axis line + profile curve + closing lines
var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
var bRv = definition.baseRadius / inch;  // unitless for vector coords
var htv = definition.height / inch;
skLineSegment(sk, "axis",  { "start" : vector(0, 0)*inch,   "end" : vector(0, htv)*inch });
skLineSegment(sk, "base",  { "start" : vector(0, 0)*inch,   "end" : vector(bRv, 0)*inch });
skLineSegment(sk, "side",  { "start" : vector(bRv, 0)*inch, "end" : vector(0, htv)*inch });
skSolve(sk);

opRevolve(context, id + "rev1", {
    "entities"     : qSketchRegion(id + "profile"),
    "axis"         : revolveAxis,
    "angleForward" : 2 * PI * radian   // full 360° revolution
});

// For organic/tapered shapes (carrots, vases, bulbs) use skFitSpline for the profile:
skFitSpline(sk, "curve", { "points" : [
    vector(bRv, 0)*inch,
    vector(bRv * 0.9, htv * 0.25)*inch,
    vector(bRv * 0.6, htv * 0.6)*inch,
    vector(0.02, htv)*inch
]});
// ALWAYS close the spline back to the axis with skLineSegment top and base lines`,
    quality_score: 0.98,
  },
  {
    title: "opLoft — lofting between two or more profile sketches",
    source: "builtin:official_docs",
    operations: ["oploft", "profilesubqueries", "newsketchonplane"],
    text: `// opLoft blends between profile sketches on different planes.
// Each profile must be a SEPARATE sketch on its OWN plane.

// Bottom profile plane (at origin)
var planeBtm = plane(skPlane.origin, skPlane.normal);
var skBtm = newSketchOnPlane(context, id + "prof1", { "sketchPlane" : planeBtm });
skCircle(skBtm, "c", { "center" : vector(0,0)*inch, "radius" : definition.baseRadius });
skSolve(skBtm);

// Top profile plane (offset by height)
var planeTop = plane(skPlane.origin + skPlane.normal * definition.height, skPlane.normal);
var skTop = newSketchOnPlane(context, id + "prof2", { "sketchPlane" : planeTop });
skCircle(skTop, "c", { "center" : vector(0,0)*inch, "radius" : definition.topRadius });
skSolve(skTop);

// Loft between them — "profileSubqueries" is the correct key (NOT "sections" or "edges")
opLoft(context, id + "loft1", {
    "profileSubqueries" : [qSketchRegion(id + "prof1"), qSketchRegion(id + "prof2")]
});

// For 3+ profiles add more entries to profileSubqueries in order along the path.
// NEVER use "sections", "edges", or "vertices" — those keys do not exist on opLoft in FS 2931.`,
    quality_score: 0.97,
  },
  {
    title: "opSweep — sweeping a profile along a path",
    source: "builtin:official_docs",
    operations: ["opsweep", "profiles", "path", "qcreatedby", "entitytype.edge"],
    text: `// opSweep extrudes a profile sketch along a path sketch wire.

// 1. Path sketch: draw the sweep spine (open wire — line, arc, or spline)
var pathSk = newSketchOnPlane(context, id + "path", { "sketchPlane" : skPlane });
skFitSpline(pathSk, "spine", { "points" : [vector(0,0)*inch, vector(1,0.5)*inch, vector(2,0)*inch] });
skSolve(pathSk);

// 2. Profile sketch on a plane PERPENDICULAR to the path start direction
//    plane(origin, normal) — normal should be along the path tangent
var profPlane = plane(skPlane.origin, skPlane.x);  // perpendicular to skPlane
var profSk = newSketchOnPlane(context, id + "prof", { "sketchPlane" : profPlane });
skCircle(profSk, "c", { "center" : vector(0,0)*inch, "radius" : definition.radius });
skSolve(profSk);

// 3. Sweep: profiles = region query, path = edge query of the path wire
opSweep(context, id + "sweep1", {
    "profiles" : qSketchRegion(id + "prof"),
    "path"     : qCreatedBy(id + "path", EntityType.EDGE)
});`,
    quality_score: 0.96,
  },
  {
    title: "opCylinder — creating a solid cylinder",
    source: "builtin:official_docs",
    operations: ["opcylinder", "bottomcenter", "topcenter", "newbodyoperationtype"],
    text: `// opCylinder creates a solid cylinder between two center points.
// Valid keys: bottomCenter (Vector), topCenter (Vector), radius (Length), operationType.
// NO startAngle, NO endAngle — those keys DO NOT EXIST.

opCylinder(context, id + "cyl1", {
    "bottomCenter"  : skPlane.origin,
    "topCenter"     : skPlane.origin + skPlane.normal * definition.height,
    "radius"        : definition.radius,
    "operationType" : NewBodyOperationType.NEW
});

// Stepped shaft: two cylinders stacked, then union
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
    quality_score: 0.97,
  },
  {
    title: "opBoolean — union, subtraction, and intersection of bodies",
    source: "builtin:official_docs",
    operations: ["opboolean", "booleanoperationtype", "union", "subtraction", "qcreatedby"],
    text: `// opBoolean combines, subtracts, or intersects solid bodies.

// Union: merge two bodies into one
opBoolean(context, id + "merge1", {
    "tools"         : qCreatedBy(id + "body2", EntityType.BODY),
    "targets"       : qCreatedBy(id + "body1", EntityType.BODY),
    "operationType" : BooleanOperationType.UNION
});

// Subtraction: cut body2 out of body1
opBoolean(context, id + "cut1", {
    "tools"         : qCreatedBy(id + "cutter", EntityType.BODY),
    "targets"       : qCreatedBy(id + "base", EntityType.BODY),
    "operationType" : BooleanOperationType.SUBTRACTION
});

// Multiple tools (union all into one target)
opBoolean(context, id + "mergeAll", {
    "tools"         : qUnion([qCreatedBy(id + "partA", EntityType.BODY), qCreatedBy(id + "partB", EntityType.BODY)]),
    "targets"       : qCreatedBy(id + "base", EntityType.BODY),
    "operationType" : BooleanOperationType.UNION
});`,
    quality_score: 0.96,
  },
  {
    title: "opFillet and opChamfer — rounding and beveling edges",
    source: "builtin:official_docs",
    operations: ["opfillet", "opchamfer", "qedgetopologyfilter", "edgetopology"],
    text: `// opFillet: rounds edges with a radius
opFillet(context, id + "fillet1", {
    "entities" : qEdgeTopologyFilter(
        qOwnedByBody(qCreatedBy(id + "body1", EntityType.BODY), EntityType.EDGE),
        EdgeTopology.TWO_SIDED
    ),
    "radius" : definition.filletRadius
});

// opChamfer: bevels edges with equal offsets
opChamfer(context, id + "cham1", {
    "entities"    : qEdgeTopologyFilter(
        qOwnedByBody(qCreatedBy(id + "body1", EntityType.BODY), EntityType.EDGE),
        EdgeTopology.TWO_SIDED
    ),
    "chamferType" : ChamferType.EQUAL_OFFSETS,
    "width"       : definition.chamferWidth
});`,
    quality_score: 0.94,
  },
  {
    title: "opShell — hollowing a solid body",
    source: "builtin:official_docs",
    operations: ["opshell", "capentity", "captype", "thickness"],
    text: `// opShell removes one face and hollows the body to create a shell.
// Must be called AFTER the solid body exists (after opExtrude or opRevolve).
// Pass the face(s) to open as "entities" — negative thickness hollows inward.

opShell(context, id + "shell1", {
    "entities"  : qCapEntity(id + "extrude1", CapType.END, EntityType.FACE),
    "thickness" : -definition.wallThickness
});

// For open-top box: open the top face only
opShell(context, id + "shell1", {
    "entities"  : qCapEntity(id + "ext1", CapType.END, EntityType.FACE),
    "thickness" : -definition.wall
});`,
    quality_score: 0.94,
  },
  {
    title: "Lambda functions inside feature body — syntax rules",
    source: "builtin:official_docs",
    operations: ["const", "function(", "lambda", "definefeature"],
    text: `// Lambda (anonymous) functions are VALUES in FeatureScript.
// They are the ONLY kind of function allowed inside a feature body (defineFeature lambda).
// Named top-level functions like "function foo(x) { }" are ILLEGAL inside the feature body.

// CORRECT — const lambda assignments inside the feature body:
const invPoint = function(t is number, rb is number)
{
    return vector((rb * (cos(t) + t * sin(t))) * inch,
                  (rb * (sin(t) - t * cos(t))) * inch);
};

const rotPoint = function(p, a is number)   // "p" is untyped — "is vector" is NOT a valid type
{
    return vector(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
};

const double = (x is number) => x * 2;     // arrow syntax also valid

// WRONG — causes "missing TOP_SEMI" and "no viable alternative" parse errors:
function invPoint(t is number, rb is number) returns vector { ... }  // ILLEGAL inside body

// WRONG — "is vector" is not a valid FS type for lambda parameters:
const fn = function(p is vector, a is number) { ... }  // FAILS — vector is a constructor, not a type

// For top-level module functions (outside defineFeature), named functions ARE allowed:
function myHelper(x is number) returns number { return x * 2; }`,
    quality_score: 1.0,
  },
  {
    title: "Spur gear involute tooth profile math",
    source: "builtin:official_docs",
    operations: ["skfitspline", "skarc", "cos(", "sin(", "sqrt(", "atan2", "pi", "for"],
    text: `// Spur gear involute tooth profile approach:
// 1. Compute gear geometry from pitch radius and tooth count
const N  = definition.numTeeth;
const rp = definition.pitchRadius / inch;     // pitch radius, unitless
const pa = definition.pressureAngleDeg * PI / 180;  // pressure angle in radians
const m  = (2 * rp) / N;                     // module (tooth size)
const ra = rp + m;                            // addendum (tip) radius
const rd = max(rp - 1.35 * m, rp * 0.5);     // dedendum (root) radius
const rb = rp * cos(pa);                      // base circle radius

// 2. Involute function: parametric curve on base circle
const invPoint = function(t is number, rb is number)
{
    return vector((rb * (cos(t) + t * sin(t))) * inch,
                  (rb * (sin(t) - t * cos(t))) * inch);
};

// 3. For each tooth, sample right flank, arc tip, mirror left flank, arc root
for (var k = 0; k < N; k += 1)
{
    const a = (2 * PI * k) / N;
    // sample 6 points on right involute flank
    // skFitSpline for involute flanks, skArc for root and tip arcs
    skFitSpline(sketch1, "rf" ~ k, { "points" : [...] });
    skArc(sketch1, "tip" ~ k, { "start" : ..., "mid" : ..., "end" : ... });
    skFitSpline(sketch1, "lf" ~ k, { "points" : [...] });
    skArc(sketch1, "root" ~ k, { "start" : ..., "mid" : ..., "end" : ... });
}
// 4. Bore circle if needed
skCircle(sketch1, "bore", { "center" : vector(0,0)*inch, "radius" : definition.boreRadius });
skSolve(sketch1);
opExtrude(context, id + "ext1", { "entities" : qSketchRegion(id + "sketch1", hasBore), "direction" : skPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : definition.faceWidth });`,
    quality_score: 0.98,
  },
  {
    title: "Plane construction and coordinate system helpers",
    source: "builtin:official_docs",
    operations: ["plane(", "evplane", "cross(", "line(", "skplane.origin", "skplane.normal"],
    text: `// Planes are used as sketch coordinate systems and revolve axis references.

// Plane at world origin, normal along Z
var skPlane = plane(WORLD_ORIGIN, Z_DIRECTION);

// Plane from user-selected face
var skPlane = isQueryEmpty(context, definition.location)
    ? plane(WORLD_ORIGIN, Z_DIRECTION)
    : evPlane(context, { "face" : definition.location });

// Offset plane (for second loft profile, dome top, etc.)
var offsetPlane = plane(skPlane.origin + skPlane.normal * definition.height, skPlane.normal);

// Perpendicular plane (for sweep profile)
var perpPlane = plane(skPlane.origin, skPlane.x);

// Revolve axis line — always a Line value, never a Query
var axis = line(skPlane.origin, skPlane.normal);                        // along normal
var axis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));      // along X axis in plane

// Vector arithmetic in FS
skPlane.origin + skPlane.normal * definition.height   // point above plane
vector(0, 0) * inch                                    // 2D origin
vector(0, 0, 0) * inch                                 // 3D origin
vector(x, y) * inch  (where x, y are unitless numbers)
definition.width / inch    (extracts unitless number from a Length)`,
    quality_score: 0.97,
  },
  {
    title: "Query functions — referencing geometry in FeatureScript",
    source: "builtin:official_docs",
    operations: ["qcreatedby", "qownedby", "qsketchregion", "qedgetopologyfilter", "qunion", "qbodytopology"],
    text: `// Queries find geometry by criteria — they do not store direct references.

// Reference bodies created by an operation
qCreatedBy(id + "ext1", EntityType.BODY)   // body created by extrude
qCreatedBy(id + "ext1", EntityType.EDGE)   // edges created by extrude
qCreatedBy(id + "ext1", EntityType.FACE)   // faces created by extrude

// Edges/faces owned by a specific body
qOwnedByBody(qCreatedBy(id + "ext1", EntityType.BODY), EntityType.EDGE)

// Filter edges by topology (for fillet targets)
qEdgeTopologyFilter(
    qOwnedByBody(qCreatedBy(id + "body", EntityType.BODY), EntityType.EDGE),
    EdgeTopology.TWO_SIDED
)

// Sketch regions
qSketchRegion(id + "sk1")           // all closed regions in sketch
qSketchRegion(id + "sk1", true)     // regions with inner loops excluded

// Combine queries
qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)])

// Cap face of extrude (for shell)
qCapEntity(id + "ext1", CapType.END, EntityType.FACE)`,
    quality_score: 0.96,
  },
];

// Map each snippet to the prompt themes that should trigger it
const FS_SNIPPET_THEMES = [
  { themes: ["sketch", "extrude", "precondition", "lambda", "any"], snippetTitle: "FeatureScript feature structure and precondition" },
  { themes: ["sketch", "circle", "rectangle", "line", "polygon", "spline", "any"], snippetTitle: "Sketch creation, entities, and skSolve" },
  { themes: ["extrude", "box", "plate", "bracket", "rect"], snippetTitle: "opExtrude — extruding a solved sketch profile" },
  { themes: ["revolve", "cone", "carrot", "organic", "vase", "bottle", "lathe"], snippetTitle: "opRevolve — revolving a closed profile around an axis" },
  { themes: ["loft", "transition", "blend", "morph", "square to circle"], snippetTitle: "opLoft — lofting between two or more profile sketches" },
  { themes: ["sweep", "pipe", "elbow", "tube", "path", "spine"], snippetTitle: "opSweep — sweeping a profile along a path" },
  { themes: ["cylinder", "shaft", "rod", "pin", "standoff", "bore", "stepped"], snippetTitle: "opCylinder — creating a solid cylinder" },
  { themes: ["boolean", "union", "subtract", "cut", "pocket", "boss", "merge"], snippetTitle: "opBoolean — union, subtraction, and intersection of bodies" },
  { themes: ["fillet", "chamfer", "round", "bevel", "edge"], snippetTitle: "opFillet and opChamfer — rounding and beveling edges" },
  { themes: ["shell", "hollow", "enclosure", "wall", "thin", "box open"], snippetTitle: "opShell — hollowing a solid body" },
  { themes: ["lambda", "function", "helper", "gear", "involute", "const"], snippetTitle: "Lambda functions inside feature body — syntax rules" },
  { themes: ["gear", "spur", "pinion", "tooth", "involute", "module", "pressure angle"], snippetTitle: "Spur gear involute tooth profile math" },
  { themes: ["plane", "axis", "coordinate", "revolve", "loft", "offset", "perpendicular"], snippetTitle: "Plane construction and coordinate system helpers" },
  { themes: ["query", "qcreatedby", "qowned", "reference", "entity", "fillet", "boolean"], snippetTitle: "Query functions — referencing geometry in FeatureScript" },
];

function listMarkdownFiles(rootPath) {
  if (!rootPath || !existsSync(rootPath)) return [];
  const found = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) visit(next);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) found.push(next);
    }
  };
  visit(rootPath);
  return found;
}

function chunkDocument(text, maxChars = 1800) {
  const normalized = String(text || "")
    .replace(/\r/g, "").replace(/\t/g, "  ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const p = normalized.lastIndexOf("\n\n", end);
      const l = normalized.lastIndexOf("\n", end);
      end = p > start + 600 ? p : l > start + 600 ? l : end;
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = end;
  }
  return chunks;
}

// Score how "foundational" a doc chunk is for FeatureScript generation
function chunkFoundationalScore(text) {
  const t = text.toLowerCase();
  let score = 0;
  const anchors = [
    ["definefeature", 4], ["precondition", 3], ["islength", 3], ["isinteger", 3],
    ["sksolve", 3], ["newsketchonplane", 2], ["qsketchregion", 2],
    ["opextrude", 2], ["oprevolve", 2], ["oploft", 2], ["opsweep", 2],
    ["opcylinder", 2], ["opboolean", 2], ["opfillet", 1], ["opshell", 1],
    ["featurescript 2931", 3], ["import(path", 2],
  ];
  for (const [term, pts] of anchors) {
    if (t.includes(term)) score += pts;
  }
  return score;
}

// Tag a chunk with the FS operation groups it covers
function tagChunkOperations(text) {
  const t = text.toLowerCase();
  return Object.entries(FS_OPERATION_GROUPS)
    .filter(([, terms]) => terms.some(term => t.includes(term)))
    .map(([group]) => group);
}

function buildFeatureScriptDocIndex(fsDocsPath) {
  const rootPath = toFsPath(fsDocsPath);
  if (!rootPath || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    return { rootPath, chunks: [], builtinOnly: true };
  }

  const chunks = [];
  for (const filePath of listMarkdownFiles(rootPath)) {
    const source = relative(rootPath, filePath).replace(/\\/g, "/");
    const fileTitle = basename(filePath, ".md").replace(/[-_]/g, " ");
    const text = readFileSync(filePath, "utf8");

    // Skip pure reference tables (custom tables, part properties) — low signal for generation
    if (/customtables|partproper/i.test(source)) continue;

    chunkDocument(text).forEach((chunk, index) => {
      const lead = normalizeText(chunk.split(/\n/)[0].replace(/^#+\s*/, ""));
      const title = /^[A-Z][A-Za-z0-9 /(),._-]{4,90}$/.test(lead) && !/[{}":;=]/.test(lead)
        ? `${fileTitle}: ${lead}`
        : `${fileTitle} ${index + 1}`;

      const operations = tagChunkOperations(chunk);
      const foundational = chunkFoundationalScore(chunk);

      // Skip chunks with zero signal for FS generation
      if (foundational === 0 && operations.length === 0) return;

      chunks.push({
        title,
        source,
        text: normalizeText(chunk).slice(0, 1800),
        keywords: `${title} ${source} ${chunk}`.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 30) || [],
        operations,       // which FS operation groups this covers
        foundational,     // higher = more essential
        quality_score: Math.min(0.5 + foundational * 0.05, 0.95),
      });
    });
  }

  return { rootPath, chunks, builtinOnly: false };
}

// ─── Memory row helpers ───────────────────────────────────────────────────────

function mapLocalKnowledge(entry) {
  return {
    memory_type: entry.memoryType || entry.memory_type || "local_seed",
    title: entry.title,
    summary: entry.summary,
    shape_type: entry.shapeType || entry.shape_type || null,
    tags: entry.tags || [],
    keywords: entry.keywords || [],
    parameter_hints: entry.parameterHints || entry.parameter_hints || [],
    modeling_notes: entry.modelingNotes || entry.modeling_notes || [],
    feature_pattern: entry.featurePattern || entry.feature_pattern || "",
    failure_modes: entry.failureModes || entry.failure_modes || [],
    validation_rules: entry.validationRules || entry.validation_rules || [],
    example_prompt: entry.examplePrompt || entry.example_prompt || null,
    quality_score: Number(entry.qualityScore ?? entry.quality_score ?? 0.65),
    source_table: entry.sourceTable || entry.source_table || "cad_knowledge",
    component_tags: entry.componentTags || entry.component_tags || [],
    operation_tags: entry.operationTags || entry.operation_tags || [],
  };
}

function mapCadKnowledge(row) {
  return {
    memory_type: "seed",
    title: row.title,
    summary: row.summary,
    tags: row.tags || [],
    keywords: row.keywords || [],
    parameter_hints: row.parameter_hints || [],
    modeling_notes: row.modeling_notes || [],
    example_prompt: row.example_prompt || null,
    quality_score: 0.7,
    source_table: row.source_table || "cad_knowledge",
    component_tags: row.component_tags || [],
    operation_tags: row.operation_tags || [],
  };
}

function mapCadMemory(row) {
  return {
    id: row.id,
    memory_type: row.memory_type || "skill",
    title: row.title,
    summary: row.summary || "",
    shape_type: row.shape_type || null,
    tags: row.tags || [],
    keywords: row.keywords || [],
    parameter_hints: row.parameter_hints || [],
    modeling_notes: row.modeling_notes || [],
    feature_pattern: row.feature_pattern || "",
    failure_modes: row.failure_modes || [],
    validation_rules: row.validation_rules || [],
    quality_score: Number(row.quality_score ?? 0.5),
    usage_count: Number(row.usage_count || 0),
    success_count: Number(row.success_count || 0),
    failure_count: Number(row.failure_count || 0),
    _score: Number(row.match_score ?? row._score ?? 0),
    source_table: row.source_table || "cad_memory",
    component_tags: row.component_tags || [],
    operation_tags: row.operation_tags || [],
  };
}

function shouldKeepMemoryRow(row) {
  const quality = Number(row.quality_score ?? 0.5);
  const success = Number(row.success_count || 0);
  const failure = Number(row.failure_count || 0);
  if (quality <= 0.05) return false;
  if (quality < 0.2 && failure >= success + 6) return false;
  const total = success + failure;
  if (total >= 5 && failure / total >= 0.8 && quality < 0.25) return false;
  return true;
}

function dedupeKnowledge(entries, limit = 16) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = normalizeText(`${entry.title || ""}:${entry.shape_type || ""}`).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length >= limit) break;
  }
  return result;
}

// Priority order for mixing retrieval sources in the final context
function knowledgePriority(entry) {
  const t = normalizeText(entry.memory_type || "").toLowerCase();
  if (t === "confirmed_generation") return 5;
  if (t === "feedback_lesson") return 4.5;
  if (t === "fs_example") return 4;
  if (t.includes("dataset")) return 3.5;
  if (t === "source_reference") return 3.25;
  if (t === "pruning_rule" || t === "local_pruning_rule") return 3;
  return 2;
}

// ─── DB write helper ──────────────────────────────────────────────────────────

async function updateOrInsertByTitle(client, table, payload, warned, warnKey = table) {
  const lookup = await client
    .from(table)
    .select("id,created_at")
    .eq("title", payload.title)
    .order("created_at", { ascending: false })
    .limit(1);

  if (lookup.error) {
    if (!isMissingDbObject(lookup.error)) {
      warnOnce(warned, `${warnKey}_lookup`, `[DB] Failed to look up ${table}: ${lookup.error.message}`);
    }
    return { data: null, error: lookup.error };
  }

  const existing = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (existing?.id) {
    return client.from(table).update(payload).eq("id", existing.id).select("id,created_at").single();
  }
  return client.from(table).insert([payload]).select("id,created_at").single();
}

// ─── Main service ─────────────────────────────────────────────────────────────

export function createLearningService({
  supabase,
  cadKnowledgePath,
  cadKnowledgeCsvPath,
  cadPruningPath,
  fsDocsPath,
}) {
  const warned = new Set();

  // Load all local knowledge at startup — used when DB is unavailable
  const localCadKnowledge = dedupeSeedEntries([
    ...loadSeedEntriesFromJson(cadKnowledgePath, { memoryType: "local_seed", qualityScore: 0.65, sourceTable: "cad_knowledge" }),
    ...loadSeedEntriesFromCsv(cadKnowledgeCsvPath, { memoryType: "local_seed", qualityScore: 0.72, sourceTable: "cad_knowledge" }),
    ...loadOptionalCsv(siblingPath(cadKnowledgeCsvPath, "cadKnowledge.new.csv"), { memoryType: "local_seed", qualityScore: 0.86, sourceTable: "cad_knowledge" }),
    ...loadOptionalCsv(siblingPath(cadKnowledgeCsvPath, "cadMemoryExamples.dataset.csv"), { memoryType: "dataset_example", qualityScore: 0.8, sourceTable: "cad_memory", memoryOnly: true }),
    ...loadSeedEntriesFromCsv(cadPruningPath, { memoryType: "local_pruning_rule", qualityScore: 0.82, sourceTable: "pruning_table", memoryOnly: true }),
    ...loadOptionalCsv(siblingPath(cadPruningPath, "cadPruningTable.new.csv"), { memoryType: "local_pruning_rule", qualityScore: 0.9, sourceTable: "pruning_table", memoryOnly: true }),
    ...loadOptionalCsv(siblingPath(cadKnowledgeCsvPath, "cadMemoryExamples.new.csv"), { memoryType: "fs_example", qualityScore: 0.88, sourceTable: "cad_memory", memoryOnly: true }),
    ...loadOptionalJson(siblingPath(cadKnowledgeCsvPath, "sourceKnowledge.new.json"), { memoryType: "source_reference", qualityScore: 0.9, sourceTable: "source_docs", memoryOnly: true }),
    
  ]);

  const featureScriptDocIndex = buildFeatureScriptDocIndex(fsDocsPath);

  if (fsDocsPath && !featureScriptDocIndex.chunks.length) {
    warnOnce(warned, "fs_docs", `[Docs] FeatureScript docs not found at ${toFsPath(fsDocsPath)}.`);
  }

  // ── Adaptive network state ──────────────────────────────────────────────────

  let adaptiveStateCache = null;
  let adaptiveStateSource = "default";
  let adaptiveStateLoadedAt = 0;

  async function loadAdaptiveState({ force = false } = {}) {
    const now = Date.now();
    if (!force && adaptiveStateCache && now - adaptiveStateLoadedAt < 60_000) return adaptiveStateCache;

    if (!supabase) {
      const local = loadLocalAdaptiveStateFile();
      adaptiveStateSource = local ? "local_file" : "default";
      adaptiveStateCache = local || createInitialAdaptiveState();
      adaptiveStateLoadedAt = now;
      return adaptiveStateCache;
    }

    const { data, error } = await supabase
      .from("cad_learning_state")
      .select("state")
      .eq("state_key", ADAPTIVE_NETWORK_KEY)
      .maybeSingle();

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "cad_learning_state", `[DB] Could not load adaptive state: ${error.message}`);
      const local = loadLocalAdaptiveStateFile();
      adaptiveStateSource = local ? "local_file" : "default";
      adaptiveStateCache = local || createInitialAdaptiveState();
      adaptiveStateLoadedAt = now;
      return adaptiveStateCache;
    }

    const local = data?.state ? null : loadLocalAdaptiveStateFile();
    adaptiveStateSource = data?.state ? "supabase" : local ? "local_file" : "default";
    adaptiveStateCache = data?.state || local || createInitialAdaptiveState();
    adaptiveStateLoadedAt = now;
    return adaptiveStateCache;
  }

  async function saveAdaptiveState(state) {
    adaptiveStateCache = state || createInitialAdaptiveState();
    adaptiveStateSource = supabase ? "supabase" : "default";
    adaptiveStateLoadedAt = Date.now();

    if (!supabase) return dbLogResult({ skipped: true, table: "cad_learning_state", action: "upsert", error: "Supabase disabled." });

    const { data, error } = await supabase
      .from("cad_learning_state")
      .upsert([{ state_key: ADAPTIVE_NETWORK_KEY, state: adaptiveStateCache, updated_at: new Date().toISOString() }], { onConflict: "state_key" })
      .select("id,updated_at")
      .single();

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "save_adaptive_state", `[DB] Could not save adaptive state: ${error.message}`);
      return dbErrorResult("cad_learning_state", "upsert", error);
    }
    return dbLogResult({ id: data?.id || null, ok: Boolean(data?.id), table: "cad_learning_state", action: "upsert", createdAt: data?.updated_at || new Date().toISOString() });
  }

  // ── Retrieval ───────────────────────────────────────────────────────────────
  // The AI model handles semantic matching. We just retrieve broadly and let the
  // adaptive reranker sort by learned quality signals.

  function getLocalKnowledge(limit = 6) {
    return [...localCadKnowledge]
      .map(entry => mapLocalKnowledge(entry))
      .sort((a, b) => Number(b.quality_score || 0) - Number(a.quality_score || 0))
      .slice(0, limit);
  }

  // Extract prompt keywords for doc routing
  function extractPromptThemes(prompt = "") {
    const t = normalizeText(prompt).toLowerCase();
    const themes = new Set(["any"]); // always include "any" theme

    // Map prompt words to theme tags
    const themeMap = [
      [/\b(gear|spur|pinion|tooth|teeth|involute|module|diametral)\b/, "gear"],
      [/\b(revolve|revolut|lathe|vase|bottle|carrot|cone|organic|round)\b/, "revolve"],
      [/\b(loft|transition|blend|morph|funnel|hopper)\b/, "loft"],
      [/\b(sweep|pipe|elbow|tube|duct|conduit|spine|path)\b/, "sweep"],
      [/\b(shell|hollow|enclosure|thin.?wall|open.?top|box.?open)\b/, "shell"],
      [/\b(fillet|chamfer|round|bevel|edge)\b/, "fillet"],
      [/\b(boolean|union|subtract|cut|pocket|boss|merge|remove)\b/, "boolean"],
      [/\b(cylinder|shaft|rod|pin|dowel|post|standoff|bore|axle)\b/, "cylinder"],
      [/\b(extrude|box|cube|block|plate|bracket|slab)\b/, "extrude"],
      [/\b(sketch|circle|rect|polygon|spline|arc|line)\b/, "sketch"],
      [/\b(plane|axis|coordinate|offset|perpendicular)\b/, "plane"],
      [/\b(query|reference|entity|topology|qcreatedby)\b/, "query"],
      [/\b(lambda|function|helper|const fn|nested function)\b/, "lambda"],
      [/\b(precondition|islength|isinteger|parameter|dialog|slider)\b/, "precondition"],
    ];

    for (const [pattern, theme] of themeMap) {
      if (pattern.test(t)) themes.add(theme);
    }
    return themes;
  }

  // Score a doc chunk against the current prompt themes
  function scoreDocChunk(chunk, themes) {
    let score = chunk.foundational ?? 0;

    // Operation group match — chunks covering what the user needs score higher
    const ops = chunk.operations || [];
    for (const op of ops) {
      if (themes.has(op)) score += 5;
    }

    // Keyword overlap with prompt themes
    const haystack = `${chunk.title} ${chunk.text}`.toLowerCase();
    for (const theme of themes) {
      if (theme === "any") continue;
      if (haystack.includes(theme)) score += 2;
    }

    // Penalty for off-topic heavy chunks
    if (/customtable|bom|bill of material|part propert/i.test(haystack)) score -= 8;

    return score;
  }

  // Score a builtin snippet against prompt themes
  function scoreBuiltinSnippet(snippet, themes) {
    let score = (snippet.quality_score ?? 0.5) * 10;
    const ops = snippet.operations || [];
    for (const op of ops) {
      if (themes.has(op) || themes.has("any")) score += 4;
    }
    // Title/text keyword match
    const haystack = `${snippet.title} ${snippet.text}`.toLowerCase();
    for (const theme of themes) {
      if (theme !== "any" && haystack.includes(theme)) score += 3;
    }
    return score;
  }

  function getFeatureScriptDocs(prompt = "", limit = 8) {
    const themes = extractPromptThemes(prompt);

    // Score and select the best local markdown chunks
    const localChunks = featureScriptDocIndex.chunks
      .map(chunk => ({ ...chunk, _score: scoreDocChunk(chunk, themes) }))
      .filter(chunk => chunk._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, Math.ceil(limit * 0.6)); // up to 60% from local docs

    // Score and select the best builtin snippets — fill the rest of the budget
    const builtinBudget = limit - localChunks.length;
    const seenTitles = new Set(localChunks.map(c => c.title));

    const builtinChunks = FS_BUILTIN_SNIPPETS
      .map(s => ({ ...s, _score: scoreBuiltinSnippet(s, themes) }))
      .filter(s => !seenTitles.has(s.title))
      .sort((a, b) => b._score - a._score)
      .slice(0, builtinBudget)
      .map(s => ({
        title:    s.title,
        source:   s.source,
        text:     s.text,
        keywords: [],
        operations: s.operations || [],
        foundational: (s.quality_score ?? 0.5) * 10,
        quality_score: s.quality_score,
      }));

    // Always include the feature structure snippet as the first entry if not already present
    const structureTitle = "FeatureScript feature structure and precondition";
    const hasStructure = [...localChunks, ...builtinChunks].some(c => c.title === structureTitle);
    let result = [...localChunks, ...builtinChunks];
    if (!hasStructure) {
      const structureSnippet = FS_BUILTIN_SNIPPETS.find(s => s.title === structureTitle);
      if (structureSnippet) {
        result = [{ ...structureSnippet, _score: 999 }, ...result].slice(0, limit);
      }
    }

    return result.slice(0, limit);
  }

  async function fetchCadMemory(prompt) {
    if (!supabase) return [];

    // Try the scored RPC first, fall back to a plain active-row fetch
    const rpc = await supabase.rpc("search_cad_memory", {
      query_text: prompt,
      query_keywords: [],      // AI model does the matching — no keyword list needed
      query_shape: null,
      match_limit: 20,
    });

    if (!rpc.error && Array.isArray(rpc.data)) {
      return rpc.data.map(mapCadMemory).filter(shouldKeepMemoryRow);
    }
    if (rpc.error && !isMissingDbObject(rpc.error)) {
      warnOnce(warned, "search_cad_memory", `[DB] CAD memory RPC unavailable: ${rpc.error.message}`);
    }

    const { data, error } = await supabase
      .from("cad_memory")
      .select("id,memory_type,title,summary,shape_type,tags,keywords,parameter_hints,modeling_notes,feature_pattern,failure_modes,validation_rules,quality_score,usage_count,success_count,failure_count,is_active")
      .eq("is_active", true)
      .order("quality_score", { ascending: false })
      .limit(40);

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "cad_memory", `[DB] Could not load CAD memory: ${error.message}`);
      return [];
    }
    return (Array.isArray(data) ? data : []).map(mapCadMemory).filter(shouldKeepMemoryRow);
  }

  async function fetchCadKnowledge() {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("cad_knowledge")
      .select("title,summary,tags,keywords,parameter_hints,modeling_notes,example_prompt,feature_pattern")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "cad_knowledge", `[DB] Could not load CAD knowledge: ${error.message}`);
      return [];
    }
    return (Array.isArray(data) ? data : []).map(mapCadKnowledge);
  }

  async function markMemoryUsed(memoryIds) {
    if (!supabase || !memoryIds.length) return;
    const { error } = await supabase.rpc("mark_cad_memory_used", { memory_ids: memoryIds });
    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "mark_cad_memory_used", `[DB] Could not mark CAD memory usage: ${error.message}`);
    }
  }

  // ── fetchLearningContext ────────────────────────────────────────────────────
  // The public entry point. Returns everything AI.js needs to build its prompt.

  async function fetchLearningContext(prompt, history = []) {
    const adaptiveState = await loadAdaptiveState();
    const rankContext = { prompt, keywords: [], shapeHint: null }; // AI does the semantic work

    const [cadMemory, cadKnowledge] = await Promise.all([
      fetchCadMemory(prompt),
      fetchCadKnowledge(),
    ]);

    const rankedMemory    = rerankCandidates(adaptiveState, cadMemory,    rankContext, "memory",    16);
    const rankedKnowledge = rerankCandidates(adaptiveState, cadKnowledge, rankContext, "knowledge", 16);
    const rankedDocs      = rerankCandidates(adaptiveState, getFeatureScriptDocs(prompt, 8), rankContext, "docs", 8);
    const localKnowledge  = rerankCandidates(adaptiveState, getLocalKnowledge(8),    rankContext, "local", 8);

    const memoryMatches = rankedMemory
      .filter(m => m.id)
      .slice(0, 16)
      .map((m, i) => ({
        memory_id:      m.id,
        score_rank:     i + 1,
        score_snapshot: Number(m._combinedScore ?? m._score ?? 0),
        neural_score:   Number(m._neuralScore ?? 0),
        feature_vector: m._featureVector || [],
        source_kind:    m._sourceKind || "memory",
      }));

    await markMemoryUsed(memoryMatches.map(m => m.memory_id));

    const allKnowledge = dedupeKnowledge([
      ...rankedMemory,
      ...rankedKnowledge,
      ...localKnowledge,
    ].sort((a, b) => {
      const pd = knowledgePriority(b) - knowledgePriority(a);
      return pd !== 0 ? pd : Number(b._combinedScore ?? b._score ?? 0) - Number(a._combinedScore ?? a._score ?? 0);
    }), 16);

    return {
      prompt,
      keywords: [],       // kept for schema compatibility; AI does semantic matching
      shapeHint: null,    // kept for schema compatibility; AI classifies the shape
      examples: [],
      notes: [
        `Neural reranker: ${adaptiveState.trainedSteps || 0} training steps, source=${adaptiveStateSource}.`,
        rankedMemory.length ? `${rankedMemory.length} CAD memory record(s) retrieved.` : "",
        rankedKnowledge.length ? `${rankedKnowledge.length} CAD knowledge record(s) retrieved.` : "",
        rankedDocs.length ? `${rankedDocs.length} FeatureScript doc snippet(s) retrieved.` : "",
      ].filter(Boolean),
      memoryMatches,
      featureScriptDocs: rankedDocs,
      knowledge: allKnowledge,
      adaptiveNetwork: {
        source:       adaptiveStateSource,
        hiddenLayers: adaptiveState.hiddenLayers,
        trainedSteps: adaptiveState.trainedSteps || 0,
      },
    };
  }

  // ── DB write operations ─────────────────────────────────────────────────────

  async function linkMemoryMatches(generationId, matches = []) {
    if (!supabase || !generationId || !matches.length) return;
    const rows = matches.map(m => ({
      generation_id:  generationId,
      memory_id:      m.memory_id,
      score_rank:     m.score_rank,
      score_snapshot: m.score_snapshot,
      neural_score:   m.neural_score,
      feature_vector: jsonSafe(m.feature_vector || []),
      source_kind:    m.source_kind || "memory",
    }));
    const { error } = await supabase.from("cad_generation_memory_matches").insert(rows);
    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "cad_generation_memory_matches", `[DB] Could not link memory to generation: ${error.message}`);
    }
  }

  async function logGeneration(prompt, result, metadata = {}) {
    if (!supabase) return dbLogResult({ skipped: true, table: "generations", action: "insert", error: "Supabase disabled." });

    const { data, error } = await supabase
      .from("generations")
      .insert([{
        prompt,
        shape_type:  result?.dims?.shape || null,
        confidence:  result?.dims?.confidence || null,
        dims:        jsonSafe(result?.dims),
        featurescript: result?.code || "",
        thinking:    result?.thinking || "",
        user_id:     metadata.userId || null,
      }])
      .select("id,created_at")
      .single();

    if (error) {
      warnOnce(warned, "log_generation", `[DB] Failed to log generation: ${error.message}`);
      return dbErrorResult("generations", "insert", error);
    }

    await linkMemoryMatches(data?.id, metadata.learningContext?.memoryMatches || []);
    return dbLogResult({ id: data?.id || null, ok: Boolean(data?.id), table: "generations", action: "insert", createdAt: data?.created_at || new Date().toISOString() });
  }

  async function logImageAnalysis({ imageCount, imageContexts, globalPrompt, aiDescription, generationId }) {
    if (!supabase) return dbLogResult({ skipped: true, table: "image_analyses", action: "insert", error: "Supabase disabled." });

    const { data, error } = await supabase.from("image_analyses").insert([{
      image_count:    imageCount,
      image_contexts: imageContexts || [],
      global_prompt:  globalPrompt || "",
      ai_description: aiDescription || "",
      generation_id:  generationId || null,
    }]).select("id,created_at").single();

    if (error && !isMissingDbObject(error)) warnOnce(warned, "image_analyses", `[DB] Failed to log image analysis: ${error.message}`);
    if (error) return dbErrorResult("image_analyses", "insert", error);
    return dbLogResult({ id: data?.id || null, ok: Boolean(data?.id), table: "image_analyses", action: "insert", createdAt: data?.created_at || new Date().toISOString() });
  }

  async function logDebugSession({ originalCode, errorMessages, fixedCode, explanation }) {
    if (!supabase) return dbLogResult({ skipped: true, table: "debug_sessions", action: "insert", error: "Supabase disabled." });

    const { data, error } = await supabase.from("debug_sessions").insert([{
      original_code:  originalCode || "",
      error_messages: errorMessages || "",
      fixed_code:     fixedCode || "",
      explanation:    explanation || "",
    }]).select("id,created_at").single();

    if (error && !isMissingDbObject(error)) warnOnce(warned, "debug_sessions", `[DB] Failed to log debug session: ${error.message}`);
    if (error) return dbErrorResult("debug_sessions", "insert", error);
    return dbLogResult({ id: data?.id || null, ok: Boolean(data?.id), table: "debug_sessions", action: "insert", createdAt: data?.created_at || new Date().toISOString() });
  }

  // ── Feedback ────────────────────────────────────────────────────────────────

  function defaultFeedbackWeight(signal, rating) {
    if (Number.isFinite(Number(rating))) return (Number(rating) - 3) * 0.04;
    return { copied: 0.04, good: 0.08, helpful: 0.08, debug_requested: -0.03, compile_error: -0.08, needs_fix: -0.08, bad: -0.12 }[signal] ?? 0;
  }

  async function trainAdaptiveNetworkFromFeedback({ generationId, signal, rating, weight }) {
    if (!supabase || !generationId) return dbLogResult({ skipped: true, table: "cad_learning_state", action: "train", error: !supabase ? "Supabase disabled." : "No generationId." });

    const { data, error } = await supabase
      .from("cad_generation_memory_matches")
      .select("feature_vector")
      .eq("generation_id", generationId)
      .limit(16);

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "adaptive_training", `[DB] Could not load training vectors: ${error.message}`);
      return dbErrorResult("cad_generation_memory_matches", "select", error);
    }

    const vectors = (Array.isArray(data) ? data : [])
      .map(r => r.feature_vector)
      .filter(v => Array.isArray(v) && v.length > 0);

    if (!vectors.length) return dbLogResult({ skipped: true, table: "cad_learning_state", action: "train", error: "No linked feature vectors found." });

    const state = await loadAdaptiveState({ force: true });
    return saveAdaptiveState(trainAdaptiveState(state, vectors, feedbackTarget(signal, rating), feedbackStrength(weight)));
  }

  async function fetchLinkedMemoryRows(generationId) {
    if (!supabase || !generationId) return [];

    const links = await supabase.from("cad_generation_memory_matches").select("memory_id").eq("generation_id", generationId).limit(32);
    if (links.error) {
      if (!isMissingDbObject(links.error)) warnOnce(warned, "feedback_memory_links", `[DB] Could not load feedback links: ${links.error.message}`);
      return [];
    }

    const ids = [...new Set((links.data || []).map(r => r.memory_id).filter(Boolean))];
    if (!ids.length) return [];

    const rows = await supabase.from("cad_memory").select("id,title,quality_score,success_count,failure_count,is_active").in("id", ids);
    if (rows.error) {
      if (!isMissingDbObject(rows.error)) warnOnce(warned, "feedback_memory_rows", `[DB] Could not load linked memory rows: ${rows.error.message}`);
      return [];
    }
    return Array.isArray(rows.data) ? rows.data : [];
  }

  function feedbackPropagationLooksApplied(beforeRows, afterRows, weight) {
    if (!beforeRows.length || !afterRows.length || weight === 0) return true;
    const afterById = new Map(afterRows.map(r => [r.id, r]));
    return beforeRows.some(before => {
      const after = afterById.get(before.id);
      if (!after) return false;
      return Math.abs(Number(after.quality_score ?? 0) - Number(before.quality_score ?? 0)) > 1e-6
          || Number(after.success_count || 0) !== Number(before.success_count || 0)
          || Number(after.failure_count || 0) !== Number(before.failure_count || 0);
    });
  }

  // When user marks a generation as good, promote the confirmed FS to cad_knowledge + cad_memory
  function isPromotionSafeFeatureScript(code = "") {
    const text = normalizeText(code);
    if (!/^FeatureScript 2931;/.test(text)) return false;
    if (!/import\(path : "onshape\/std\/geometry\.fs", version : "2931\.0"\);/.test(text)) return false;
    if ((text.match(/\bexport const\b/g) || []).length !== 1) return false;
    if (!/\bskSolve\s*\(/.test(text) && /\bnewSketch(?:OnPlane)?\s*\(/.test(text)) return false;
    if (/\b(opCut|opBore|opPlateHoles|qEdges|qEdgeAll|qBodyFaces|qAllEdges)\s*\(/.test(text)) return false;
    return text.length >= 120;
  }

  async function promoteGenerationToKnowledge(generationId, signal, safeRating, prompt) {
    if (!supabase || !generationId) return;
    const isGood = ["good", "helpful", "copied"].includes(signal) || Number(safeRating) >= 4;
    if (!isGood) return;

    const { data: gen, error } = await supabase
      .from("generations")
      .select("id,prompt,shape_type,featurescript,thinking")
      .eq("id", generationId)
      .maybeSingle();

    if (error || !gen?.featurescript || !isPromotionSafeFeatureScript(gen.featurescript)) return;

    const title = normalizeText(prompt || gen.prompt || "").slice(0, 100) || `Confirmed ${generationId.slice(0, 8)}`;
    const summary = normalizeText(gen.thinking || "").slice(0, 280) || `Confirmed FeatureScript: ${title}`;
    const shapeType = gen.shape_type || null;
    const keywords = normalizeText(gen.prompt || "").toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 10) || [];

    const { error: kErr } = await updateOrInsertByTitle(supabase, "cad_knowledge", {
      title, summary,
      tags: [shapeType, "confirmed", "user_approved"].filter(Boolean),
      keywords,
      parameter_hints: ["Preserve editable dimensions exposed in precondition."],
      modeling_notes: [`User confirmed. Prompt: ${normalizeText(gen.prompt || "").slice(0, 150)}`],
      example_prompt: normalizeText(gen.prompt || "").slice(0, 200),
      feature_pattern: (gen.featurescript || "").slice(0, 1000),
    }, warned, "promote_knowledge");

    if (kErr && !isMissingDbObject(kErr)) warnOnce(warned, "promote_knowledge", `[DB] Could not promote to cad_knowledge: ${kErr.message}`);
    else if (!kErr) console.log(`[Learning] ✓ Promoted to cad_knowledge: "${title}"`);

    const { error: mErr } = await supabase.from("cad_memory").upsert([{
      memory_type: "confirmed_generation", title, summary, shape_type: shapeType,
      tags: [shapeType, "confirmed", "user_approved"].filter(Boolean),
      keywords,
      parameter_hints: ["Preserve editable dimensions."],
      modeling_notes: [`User confirmed. Prompt: ${normalizeText(gen.prompt || "").slice(0, 150)}`],
      feature_pattern: (gen.featurescript || "").slice(0, 1000),
      failure_modes: [],
      validation_rules: ["Confirmed working by user"],
      quality_score: 0.88,
      source_table: "generations",
      is_active: true,
    }], { onConflict: "title" });

    if (mErr && !isMissingDbObject(mErr)) warnOnce(warned, "promote_memory", `[DB] Could not promote to cad_memory: ${mErr.message}`);
  }

  async function applyManualFeedbackPropagation(memoryRows, weight) {
    if (!supabase || !memoryRows.length) return dbLogResult({ skipped: true, table: "cad_memory", action: "manual_feedback", error: !supabase ? "Supabase disabled." : "No linked memory rows." });

    const { successDelta, failureDelta } = feedbackCountersForWeight(weight);
    const { error } = await supabase.from("cad_memory").upsert(
      memoryRows.map(row => ({
        id: row.id,
        quality_score: clampQualityScore(Number(row.quality_score ?? 0.5) + weight),
        success_count: Number(row.success_count || 0) + successDelta,
        failure_count: Number(row.failure_count || 0) + failureDelta,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" }
    );

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "manual_feedback", `[DB] Manual feedback failed: ${error.message}`);
      return dbErrorResult("cad_memory", "manual_feedback", error);
    }
    return dbLogResult({ ok: true, table: "cad_memory", action: "manual_feedback", createdAt: new Date().toISOString(), details: { affectedRows: memoryRows.length } });
  }

  async function runPruneCadMemory() {
    if (!supabase) return dbLogResult({ skipped: true, table: "cad_memory_pruning_events", action: "prune", error: "Supabase disabled." });

    const rpc = await supabase.rpc("prune_cad_memory");
    if (!rpc.error) return dbLogResult({ ok: true, table: "cad_memory_pruning_events", action: "prune", createdAt: new Date().toISOString(), details: { prunedCount: Number(rpc.data || 0) } });

    if (rpc.error && !isMissingDbObject(rpc.error)) warnOnce(warned, "prune_cad_memory_rpc", `[DB] prune_cad_memory RPC failed: ${rpc.error.message}`);

    // Manual fallback: deactivate rows that have been consistently bad
    const candidates = await supabase.from("cad_memory").select("id,quality_score").eq("is_active", true).gt("failure_count", 3).lt("quality_score", 0.2).limit(64);
    if (candidates.error) {
      if (!isMissingDbObject(candidates.error)) warnOnce(warned, "prune_candidates", `[DB] Could not load prune candidates: ${candidates.error.message}`);
      return dbErrorResult("cad_memory", "prune", candidates.error);
    }

    const rows = Array.isArray(candidates.data) ? candidates.data : [];
    if (!rows.length) return dbLogResult({ ok: true, table: "cad_memory_pruning_events", action: "prune", createdAt: new Date().toISOString(), details: { prunedCount: 0 } });

    await supabase.from("cad_memory").update({ is_active: false }).in("id", rows.map(r => r.id));
    await supabase.from("cad_memory_pruning_events").insert(rows.map(r => ({ memory_id: r.id, reason: "fallback prune: failure_count > 3, quality < 0.2", quality_score_before: r.quality_score })));

    return dbLogResult({ ok: true, table: "cad_memory_pruning_events", action: "prune", createdAt: new Date().toISOString(), details: { prunedCount: rows.length, fallback: true } });
  }

  async function recordFeedback({ generationId, signal = "feedback", rating, feedback, weight }) {
    if (!supabase || !generationId) return { ok: false, skipped: true, createdAt: new Date().toISOString(), error: !supabase ? "Supabase disabled." : "No generationId." };

    const safeRating = Number.isFinite(Number(rating)) ? Math.max(1, Math.min(5, Math.round(Number(rating)))) : null;
    const safeWeight = Number.isFinite(Number(weight)) ? Number(weight) : defaultFeedbackWeight(signal, safeRating);
    const linkedBefore = await fetchLinkedMemoryRows(generationId);

    const rpc = await supabase.rpc("record_cad_feedback", {
      p_generation_id: generationId,
      p_signal: signal,
      p_weight: safeWeight,
      p_notes: feedback || null,
      p_rating: safeRating,
    });

    if (!rpc.error) {
      const linkedAfter = await fetchLinkedMemoryRows(generationId);
      let propagation = null;
      if (!feedbackPropagationLooksApplied(linkedBefore, linkedAfter, safeWeight)) {
        propagation = await applyManualFeedbackPropagation(linkedBefore, safeWeight);
      }
      await promoteGenerationToKnowledge(generationId, signal, safeRating, feedback);
      const prune = await runPruneCadMemory();
      const adaptiveNetwork = await trainAdaptiveNetworkFromFeedback({ generationId, signal, rating: safeRating, weight: safeWeight });
      return { ok: true, weight: safeWeight, adaptiveNetwork, prune, propagation, createdAt: new Date().toISOString() };
    }

    if (rpc.error && !isMissingDbObject(rpc.error)) warnOnce(warned, "record_cad_feedback_rpc", `[DB] Feedback RPC failed: ${rpc.error.message}`);

    // Fallback: write the event directly
    const event = await supabase.from("cad_feedback_events").insert([{ generation_id: generationId, signal, rating: safeRating, weight: safeWeight, notes: feedback || null }]);
    if (event.error && !isMissingDbObject(event.error)) warnOnce(warned, "cad_feedback_events", `[DB] Failed to log feedback event: ${event.error.message}`);

    await supabase.from("generations").update(Object.fromEntries(
      [safeRating && ["user_rating", safeRating], feedback && ["user_feedback", feedback]].filter(Boolean)
    )).eq("id", generationId);

    const propagation = await applyManualFeedbackPropagation(linkedBefore, safeWeight);
    await promoteGenerationToKnowledge(generationId, signal, safeRating, feedback);
    const prune = await runPruneCadMemory();
    const adaptiveNetwork = await trainAdaptiveNetworkFromFeedback({ generationId, signal, rating: safeRating, weight: safeWeight });

    return { ok: !event.error || isMissingDbObject(event.error), weight: safeWeight, adaptiveNetwork, propagation, prune, createdAt: new Date().toISOString(), error: event.error && !isMissingDbObject(event.error) ? event.error.message : null };
  }

  // ── Learning analysis ───────────────────────────────────────────────────────

  async function fetchGenerationSnapshot({ generationId, prompt }) {
    if (!supabase) return { supabaseEnabled: false, generation: null, memoryMatches: [], feedbackEvents: [], diagnostics: await diagnostics() };

    let generation = null;
    if (generationId) {
      const { data, error } = await supabase.from("generations").select("id,created_at,prompt,shape_type,confidence,dims,thinking,user_rating,user_feedback,char_count").eq("id", generationId).maybeSingle();
      if (!error) generation = data || null;
    }
    if (!generation && prompt) {
      const { data, error } = await supabase.from("generations").select("id,created_at,prompt,shape_type,confidence,dims,thinking,user_rating,user_feedback,char_count").ilike("prompt", `%${String(prompt).slice(0, 80)}%`).order("created_at", { ascending: false }).limit(1);
      if (!error && Array.isArray(data)) generation = data[0] || null;
    }

    const matches = generation?.id
      ? await supabase.from("cad_generation_memory_matches").select("score_rank,score_snapshot,cad_memory(id,title,shape_type,quality_score,usage_count,success_count,failure_count)").eq("generation_id", generation.id).order("score_rank", { ascending: true })
      : { data: [], error: null };

    const feedback = generation?.id
      ? await supabase.from("cad_feedback_events").select("signal,rating,weight,notes,created_at").eq("generation_id", generation.id).order("created_at", { ascending: false }).limit(8)
      : { data: [], error: null };

    return {
      supabaseEnabled: true,
      generation,
      memoryMatches: matches.error ? [] : matches.data || [],
      feedbackEvents: feedback.error ? [] : feedback.data || [],
      diagnostics: await diagnostics(),
    };
  }

  async function saveLearningAnalysis({ analysis, prompt, generationId, signal, rating, feedback }) {
    if (!supabase) return dbLogResult({ skipped: true, table: "cad_memory", action: "upsert", error: "Supabase disabled." });

    const candidate = analysis?.memoryCandidate || analysis?.memory_candidate || null;
    if (!candidate?.title) return dbLogResult({ skipped: true, table: "cad_memory", action: "upsert", error: "No memory candidate from AI analysis." });

    const title = normalizeText(candidate.title).slice(0, 120);
    const summary = [
      normalizeText(candidate.summary || analysis?.summary || ""),
      generationId ? `Source: ${generationId}.` : "",
      signal ? `Signal: ${signal}.` : "",
      rating ? `Rating: ${rating}.` : "",
      feedback ? normalizeText(feedback).slice(0, 240) : "",
    ].filter(Boolean).join(" ");

    const memoryPayload = {
      memory_type: "feedback_lesson", title, summary,
      shape_type: candidate.shape_type || candidate.shapeType || null,
      tags: safeTextArray(candidate.tags || ["feedback", "generated"]),
      keywords: safeTextArray(candidate.keywords || []),
      parameter_hints: safeTextArray(candidate.parameterHints || candidate.parameter_hints),
      modeling_notes: safeTextArray(candidate.modelingNotes || candidate.modeling_notes),
      feature_pattern: normalizeText(candidate.featurePattern || candidate.feature_pattern || "").slice(0, 1000) || null,
      failure_modes: safeTextArray(candidate.failureModes || candidate.failure_modes),
      validation_rules: safeTextArray(candidate.validationRules || candidate.validation_rules),
      quality_score: clampQualityScore(candidate.qualityScore ?? candidate.quality_score, signal === "good" || Number(rating) >= 4 ? 0.68 : 0.45),
      source_table: "cad_feedback_events",
      is_active: true,
    };

    const { data, error } = await supabase.from("cad_memory").upsert([memoryPayload], { onConflict: "title" }).select("id,created_at").single();
    if (error) {
      warnOnce(warned, "save_learning_analysis", `[DB] Failed to save AI learning analysis: ${error.message}`);
      return dbErrorResult("cad_memory", "upsert", error);
    }

    const knowledge = await updateOrInsertByTitle(supabase, "cad_knowledge", {
      title, summary,
      tags: memoryPayload.tags, keywords: memoryPayload.keywords,
      parameter_hints: memoryPayload.parameter_hints,
      modeling_notes: memoryPayload.modeling_notes,
      example_prompt: normalizeText(candidate.examplePrompt || candidate.example_prompt || prompt).slice(0, 500) || null,
    }, warned, "save_learning_analysis_knowledge");

    if (knowledge.error && !isMissingDbObject(knowledge.error)) warnOnce(warned, "save_learning_analysis_knowledge", `[DB] Failed to save to cad_knowledge: ${knowledge.error.message}`);

    return dbLogResult({
      id: data?.id || null, ok: Boolean(data?.id), table: "cad_memory", action: "upsert",
      createdAt: data?.created_at || new Date().toISOString(),
      details: {
        cadKnowledge: knowledge.error
          ? dbErrorResult("cad_knowledge", "upsert", knowledge.error)
          : dbLogResult({ id: knowledge.data?.id || null, ok: Boolean(knowledge.data?.id), table: "cad_knowledge", action: "upsert", createdAt: knowledge.data?.created_at || new Date().toISOString() }),
      },
    });
  }

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  async function countTable(table) {
    if (!supabase) return { table, available: false, count: 0, error: "Supabase disabled" };
    const { count, error } = await supabase.from(table).select("id", { count: "exact" }).limit(1);
    return { table, available: !error, count: count || 0, error: error?.message || null };
  }

  async function diagnostics() {
    const tables = await Promise.all([
      "generations", "cad_knowledge", "shape_knowledge", "cad_memory",
      "cad_generation_memory_matches", "cad_feedback_events",
      "cad_memory_pruning_events", "cad_learning_state",
      "image_analyses", "debug_sessions",
    ].map(countTable));

    const [recentGenerations, topMemory] = supabase
      ? await Promise.all([
          supabase.from("generations").select("id,created_at,prompt,shape_type,confidence,user_rating,char_count").order("created_at", { ascending: false }).limit(5),
          supabase.from("cad_memory").select("id,title,shape_type,quality_score,usage_count,success_count,failure_count,is_active").order("quality_score", { ascending: false }).limit(8),
        ])
      : [{ data: [] }, { data: [] }];

    const missingAdaptiveTables = tables.filter(t => REQUIRED_ADAPTIVE_TABLES.includes(t.table) && !t.available).map(t => t.table);
    const adaptiveState = await loadAdaptiveState();

    return {
      supabaseEnabled: Boolean(supabase),
      schemaReady: missingAdaptiveTables.length === 0,
      missingAdaptiveTables,
      featureScriptDocs: {
        enabled: featureScriptDocIndex.chunks.length > 0,
        chunks: featureScriptDocIndex.chunks.length,
        source: featureScriptDocIndex.rootPath ? "old_and_docs/docs/FS doc" : null,
      },
      adaptiveNetwork: {
        key: ADAPTIVE_NETWORK_KEY,
        source: adaptiveStateSource,
        hiddenLayers: adaptiveState.hiddenLayers,
        trainedSteps: adaptiveState.trainedSteps || 0,
        inputSize: adaptiveState.inputSize,
      },
      tables,
      recentGenerations: recentGenerations.error ? [] : recentGenerations.data || [],
      topMemory: topMemory.error ? [] : topMemory.data || [],
      notes: [
        "cad_memory: scored skill records — quality_score updated by feedback.",
        "cad_knowledge: confirmed working examples — grows when users mark results as good.",
        "cad_generation_memory_matches: links each generation to the memories that influenced it.",
        "cad_feedback_events: copy/good/bad signals → quality score updates.",
        "cad_learning_state: trainable neural reranker weights.",
        "If adaptive tables are missing, run supabase/migrations/20260505213000_adaptive_cad_memory.sql then npm run seed:knowledge.",
      ],
    };
  }

  return {
    fetchLearningContext,
    logGeneration,
    logImageAnalysis,
    logDebugSession,
    recordFeedback,
    fetchGenerationSnapshot,
    saveLearningAnalysis,
    diagnostics,
  };
}