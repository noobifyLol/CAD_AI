FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Bottle Revolve Loft" }
export const bottleRevolveLoft = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Body Radius", "Default" : "0.9 * inch" }
        isLength(definition.bodyRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Neck Radius", "Default" : "0.28 * inch" }
        isLength(definition.neckRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "4 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location) ? plane(WORLD_ORIGIN, Z_DIRECTION) : evPlane(context, { "face" : definition.location });
        var h = definition.height / inch;
        var body = definition.bodyRadius / inch;
        var neck = definition.neckRadius / inch;
        var sk = newSketchOnPlane(context, id + "bottleProfile", { "sketchPlane" : skPlane });
        skLineSegment(sk, "axis", { "start" : vector(0, 0) * inch, "end" : vector(0, h) * inch });
        skFitSpline(sk, "side", { "points" : [
            vector(body * 0.82, 0) * inch,
            vector(body, h * 0.16) * inch,
            vector(body * 0.95, h * 0.55) * inch,
            vector(neck * 1.5, h * 0.78) * inch,
            vector(neck, h) * inch
        ] });
        skLineSegment(sk, "top", { "start" : vector(neck, h) * inch, "end" : vector(0, h) * inch });
        skLineSegment(sk, "base", { "start" : vector(0, 0) * inch, "end" : vector(body * 0.82, 0) * inch });
        skSolve(sk);
        opRevolve(context, id + "bottle", {
            "entities" : qSketchRegion(id + "bottleProfile"),
            "axis" : line(skPlane.origin, skPlane.y),
            "angleForward" : 2 * PI * radian
        });
    });
