FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

// ── Part kit ────────────────────────────────────────────────────────────────
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

// A flat-screen TV standing on a pedestal stand, with a recessed screen inside a bezel and an
// RJ45 Ethernet port on the back, plus an optional cable plugged into it. Built with the part
// kit: the TV stands up along z (height = sizeZ, front = -y, back = +y), every bottomZ is the
// BOTTOM of its piece, and attached pieces sink 0.05 in into each other so they merge.
annotation { "Feature Type Name" : "TV With Stand And Ethernet Port" }
export const tvWithStand = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [8, 24, 80] } as LengthBoundSpec);
        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [5, 14, 48] } as LengthBoundSpec);
        annotation { "Name" : "Depth" }
        isLength(definition.depth, { (inch) : [0.4, 1.5, 6] } as LengthBoundSpec);
        annotation { "Name" : "Bezel Border" }
        isLength(definition.bezel, { (inch) : [0.05, 0.4, 2] } as LengthBoundSpec);
        annotation { "Name" : "Screen Recess" }
        isLength(definition.screenRecess, { (inch) : [0.01, 0.06, 0.25] } as LengthBoundSpec);

        annotation { "Name" : "Neck Radius" }
        isLength(definition.neckRadius, { (inch) : [0.1, 0.5, 3] } as LengthBoundSpec);
        annotation { "Name" : "Neck Height" }
        isLength(definition.neckHeight, { (inch) : [0.25, 2.5, 12] } as LengthBoundSpec);
        annotation { "Name" : "Base Width" }
        isLength(definition.baseWidth, { (inch) : [2, 10, 40] } as LengthBoundSpec);
        annotation { "Name" : "Base Depth" }
        isLength(definition.baseDepth, { (inch) : [1, 5, 20] } as LengthBoundSpec);
        annotation { "Name" : "Base Thickness" }
        isLength(definition.baseThickness, { (inch) : [0.06, 0.3, 1] } as LengthBoundSpec);

        annotation { "Name" : "Port Offset From Right Edge" }
        isLength(definition.portOffset, { (inch) : [0.2, 2, 40] } as LengthBoundSpec);
        annotation { "Name" : "Port Height Above TV Bottom" }
        isLength(definition.portElevation, { (inch) : [0.2, 2, 40] } as LengthBoundSpec);
        annotation { "Name" : "Show Ethernet Cable", "Default" : true }
        definition.showCable is boolean;
        annotation { "Name" : "Cable Run Behind TV" }
        isLength(definition.cableLength, { (inch) : [0.25, 3, 36] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Real RJ45 port and plug sizes; everything else comes from the dialog.
        var portWidth = 0.46 * inch;
        var portHeight = 0.53 * inch;
        var plugOut = 0.7 * inch;
        var cableRadius = 0.12 * inch;
        var sink = 0.05 * inch; // overlap between attached pieces so they merge into one part

        var w = definition.width;
        var h = definition.height;
        var d = definition.depth;
        // Keep the screen, the port and the cable inside the TV for any dialog values.
        var bezel = min(definition.bezel, min(w, h) / 4);
        var recess = min(definition.screenRecess, d / 4);
        var portDepth = min(0.6 * inch, d / 2);
        var portOffset = min(definition.portOffset, w - portWidth - 0.1 * inch);
        var portBottomAboveTv = min(definition.portElevation, h - portHeight - 0.1 * inch);

        // 1) Stand: a base plate on the plane and a round neck up into the bottom of the TV.
        var tvBottom = definition.baseThickness + definition.neckHeight;
        kitBox(context, id + "base", skPlane, 0, 0, 0, definition.baseWidth, definition.baseDepth, definition.baseThickness);
        kitCylinder(context, id + "neck", skPlane, 0, 0, definition.baseThickness - sink, definition.neckRadius, definition.neckHeight + 2 * sink);

        // 2) TV body, standing up: width along x, depth along y, height along z.
        kitBox(context, id + "body", skPlane, 0, 0, tvBottom, w, d, h);

        // 3) Screen: a shallow pocket in the front face, leaving the bezel border around it.
        kitBox(context, id + "screen", skPlane, 0, -d / 2 + (recess - sink) / 2, tvBottom + bezel,
            w - 2 * bezel, recess + sink, h - 2 * bezel);

        // 4) Ethernet port: a rectangular pocket in the back face near the right edge.
        var portX = w / 2 - portOffset - portWidth / 2;
        var portBottom = tvBottom + portBottomAboveTv;
        kitBox(context, id + "port", skPlane, portX, d / 2 + (sink - portDepth) / 2, portBottom,
            portWidth, portDepth + sink, portHeight);
        kitCut(context, id + "cuts", id + "body", [id + "screen", id + "port"]);

        var pieces = [id + "body", id + "neck", id + "base"];

        // 5) Optional cable: a plug seated in the port, then a cable that runs back and drops to the table.
        if (definition.showCable)
        {
            var portMidZ = portBottom + portHeight / 2;
            kitBox(context, id + "plug", skPlane, portX, d / 2 + (plugOut - portDepth - sink) / 2, portBottom + 0.03 * inch,
                portWidth - 0.04 * inch, portDepth + sink + plugOut, portHeight - 0.06 * inch);
            var cableEndY = d / 2 + plugOut + definition.cableLength;
            kitRod(context, id + "cableBack", skPlane, portX, d / 2 + plugOut - sink, portMidZ, portX, cableEndY + cableRadius, portMidZ, cableRadius);
            kitRod(context, id + "cableDown", skPlane, portX, cableEndY, portMidZ + cableRadius, portX, cableEndY, 0, cableRadius);
            pieces = append(pieces, id + "plug");
            pieces = append(pieces, id + "cableBack");
            pieces = append(pieces, id + "cableDown");
        }

        // 6) One solid part.
        kitMerge(context, id + "join", pieces);
    });
