FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Hex Nut" }
export const hexNut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Across Flats" }
        isLength(definition.acrossFlats, { (inch) : [0.1, 0.44, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Thickness" }
        isLength(definition.thickness, { (inch) : [0.02, 0.17, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Bore Radius" }
        isLength(definition.boreRadius, { (inch) : [0.02, 0.1, 1.0] } as LengthBoundSpec);
    }
    {
        // A nut is a hex head with a concentric threaded bore, NOT a bolt: no shaft,
        // no chamfer — just the hex prism and its center hole in one sketch.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // "Across flats" is the distance between opposite flat sides; the circumscribed
        // radius (center to vertex) used by skRegularPolygon is acrossFlats / sqrt(3).
        var circumR = definition.acrossFlats / sqrt(3);

        var nutSketch = newSketchOnPlane(context, id + "nutSketch", { "sketchPlane" : skPlane });
        skRegularPolygon(nutSketch, "hex", {
            "center"      : vector(0, 0) * inch,
            "firstVertex" : vector(1, 0) * circumR,
            "sides"       : 6
        });
        skCircle(nutSketch, "bore", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.boreRadius
        });
        skSolve(nutSketch);

        opExtrude(context, id + "nutBody", {
            "entities"  : qSketchRegion(id + "nutSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
    });
