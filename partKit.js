/**
 * partKit.js: a small set of FeatureScript helper functions ("part kit") that generated code
 * can call instead of hand-writing sketches and planes for every box, cylinder and hole.
 * Most generation failures on complex objects are placement mistakes (wrong plane, mixed
 * units, pieces that never touch); with the kit a design is a list of blocks at x, y, z.
 *
 * The helper source is appended to any file that calls kitBox / kitCylinder / kitRod /
 * kitMerge / kitCut (ensurePartKit), right after the import line, so the file stays a
 * normal self-contained Feature Studio script.
 */
export const PART_KIT_SOURCE = `// ── Part kit ────────────────────────────────────────────────────────────────
// Positions are x, y, z in the sketch plane's frame: x along the plane's x axis, y across
// it, z up along the normal. Plain numbers are taken as inches.
function kitLen(value)
{
    return value is number ? value * inch : value;
}

function kitPoint(skPlane is Plane, x, y, z) returns Vector
{
    return skPlane.origin + skPlane.x * kitLen(x) + cross(skPlane.normal, skPlane.x) * kitLen(y) + skPlane.normal * kitLen(z);
}

// Box centered at (centerX, centerY), standing from bottomZ up to bottomZ + sizeZ.
function kitBox(context is Context, id is Id, skPlane is Plane, centerX, centerY, bottomZ, sizeX, sizeY, sizeZ)
{
    var base = plane(kitPoint(skPlane, centerX, centerY, bottomZ), skPlane.normal, skPlane.x);
    var boxSketch = newSketchOnPlane(context, id + "sk", { "sketchPlane" : base });
    skRectangle(boxSketch, "outline", {
        "firstCorner" : vector(-kitLen(sizeX) / 2, -kitLen(sizeY) / 2),
        "secondCorner" : vector(kitLen(sizeX) / 2, kitLen(sizeY) / 2)
    });
    skSolve(boxSketch);
    opExtrude(context, id + "body", {
        "entities" : qSketchRegion(id + "sk"),
        "direction" : skPlane.normal,
        "endBound" : BoundingType.BLIND,
        "endDepth" : kitLen(sizeZ)
    });
    opDeleteBodies(context, id + "tidy", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
}

// Upright cylinder centered at (centerX, centerY), from bottomZ up to bottomZ + height.
function kitCylinder(context is Context, id is Id, skPlane is Plane, centerX, centerY, bottomZ, radius, height)
{
    fCylinder(context, id + "body", {
        "bottomCenter" : kitPoint(skPlane, centerX, centerY, bottomZ),
        "topCenter" : kitPoint(skPlane, centerX, centerY, kitLen(bottomZ) + kitLen(height)),
        "radius" : kitLen(radius)
    });
}

// Round bar between two points, in any direction (axles, handles, tubes, pins, cross holes).
function kitRod(context is Context, id is Id, skPlane is Plane, x1, y1, z1, x2, y2, z2, radius)
{
    fCylinder(context, id + "body", {
        "bottomCenter" : kitPoint(skPlane, x1, y1, z1),
        "topCenter" : kitPoint(skPlane, x2, y2, z2),
        "radius" : kitLen(radius)
    });
}

// Joins pieces into one solid. Afterwards the solid is known by the FIRST id in the list.
function kitMerge(context is Context, id is Id, partIds is array)
{
    var pieces = [];
    for (var partId in partIds)
    {
        pieces = append(pieces, qCreatedBy(partId, EntityType.BODY));
    }
    opBoolean(context, id, { "tools" : qUnion(pieces), "operationType" : BooleanOperationType.UNION });
}

// Removes every cutter from the target (holes, slots, pockets). The target keeps its id.
function kitCut(context is Context, id is Id, targetId is Id, cutterIds is array)
{
    var cutters = [];
    for (var cutterId in cutterIds)
    {
        cutters = append(cutters, qCreatedBy(cutterId, EntityType.BODY));
    }
    opBoolean(context, id, {
        "tools" : qUnion(cutters),
        "targets" : qCreatedBy(targetId, EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
`;

/** What the AI is told about the kit (goes into the system prompt). */
export const PART_KIT_PROMPT = `═══ PART KIT (PREFERRED for anything made of boxes, plates, walls, bars, tubes, posts, cylinders, holes, slots, pockets) ═══
These helpers are already defined for you (never define them yourself). Arguments are lengths (definition.x, 0.5 * inch) or plain numbers meaning inches.
Positions are x, y, z in the sketch plane frame: x along skPlane.x, y across it, z up along the normal. z = 0 is the plane.
- kitBox(context, id + "name", skPlane, centerX, centerY, bottomZ, sizeX, sizeY, sizeZ);
- kitCylinder(context, id + "name", skPlane, centerX, centerY, bottomZ, radius, height);      (upright)
- kitRod(context, id + "name", skPlane, x1, y1, z1, x2, y2, z2, radius);      (round bar between two points, any direction)
- kitMerge(context, id + "join", [id + "main", id + "other", ...]);      one solid, known afterwards as the FIRST id
- kitCut(context, id + "cut", id + "main", [id + "holeA", id + "pocket", ...]);      removes the cutters from the target
Method, like a machinist: 1) main body; 2) hollow it with kitCut if it is a container; 3) add pieces, each sunk at least 0.02 in into what it
attaches to (never just touching, never floating); 4) kitMerge everything onto the main body; 5) make cutters longer than the wall they pierce so
they stick out both sides, then kitCut. Use one distinct id name per piece. Sketch/extrude/revolve code is still fine for round or curved shapes.
Example body (open tray with a center divider and a carry handle on two posts):
        var w = definition.width; var d = definition.depth; var h = definition.height; var t = definition.wall;
        kitBox(context, id + "main", skPlane, 0, 0, 0, w, d, h);
        kitBox(context, id + "pocket", skPlane, 0, 0, t, w - 2 * t, d - 2 * t, h);
        kitCut(context, id + "hollow", id + "main", [id + "pocket"]);
        kitBox(context, id + "divider", skPlane, 0, 0, t / 2, t, d - t, h - t / 2);
        kitBox(context, id + "postL", skPlane, -w / 2 + t / 2, 0, h - 0.1 * inch, t, t * 2, definition.handleHeight);
        kitBox(context, id + "postR", skPlane, w / 2 - t / 2, 0, h - 0.1 * inch, t, t * 2, definition.handleHeight);
        kitRod(context, id + "grip", skPlane, -w / 2, 0, h + definition.handleHeight - t, w / 2, 0, h + definition.handleHeight - t, t / 2);
        kitMerge(context, id + "join", [id + "main", id + "divider", id + "postL", id + "postR", id + "grip"]);`;

/** Removes the kit source again (to keep AI edit prompts short; ensurePartKit re-adds it). */
export function stripPartKit(code) {
  const text = String(code || "");
  const normalized = text.replace(/\r\n/g, "\n");
  const at = normalized.indexOf(PART_KIT_SOURCE);
  if (at < 0) return text;
  return (normalized.slice(0, at).replace(/\n+$/, "\n") + normalized.slice(at + PART_KIT_SOURCE.length).replace(/^\n+/, "\n"));
}

const KIT_CALL =/\bkit(?:Box|Cylinder|Rod|Merge|Cut|Point|Len)\s*\(/;

/** Appends the kit source (after the import line) to code that calls it; idempotent. */
export function ensurePartKit(code) {
  const text = String(code || "");
  if (!KIT_CALL.test(text) || /\bfunction\s+kitLen\s*\(/.test(text)) return text;
  // Drop any helper the model wrote itself under a kit name, then add the tested ones.
  const importLine = text.match(/^import\s*\([^)]*\)\s*;[ \t]*\r?\n/m);
  if (!importLine) return `${text.trimEnd()}\n\n${PART_KIT_SOURCE}`;
  const at = importLine.index + importLine[0].length;
  return `${text.slice(0, at)}\n${PART_KIT_SOURCE}\n${text.slice(at)}`;
}
