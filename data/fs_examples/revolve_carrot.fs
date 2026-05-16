FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Organic Revolve Carrot" }
export const organicRevolveCarrot = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Base Radius", "Default" : "0.75 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "4 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Radius", "Default" : "0.06 * inch" }
        isLength(definition.tipRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Curvature Factor", "Default" : "100" }
        isInteger(definition.curvatureFactor, {(unitless) : [60, 100, 140]});
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var b = definition.baseRadius / inch;
        var h = definition.height / inch;
        var t = definition.tipRadius / inch;
        var c = definition.curvatureFactor / 100;
        var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
        skLineSegment(sk, "axis", { "start" : vector(0, 0) * inch, "end" : vector(0, h) * inch });
        skFitSpline(sk, "skin", { "points" : [
            vector(b, 0) * inch,
            vector(b * (0.88 + 0.04 * c), h * 0.20) * inch,
            vector(b * (0.62 + 0.08 * c), h * 0.45) * inch,
            vector(b * (0.32 + 0.06 * c), h * 0.70) * inch,
            vector(t, h) * inch
        ] });
        skLineSegment(sk, "tipClose", { "start" : vector(t, h) * inch, "end" : vector(0, h) * inch });
        skLineSegment(sk, "baseClose", { "start" : vector(0, 0) * inch, "end" : vector(b, 0) * inch });
        skSolve(sk);
        var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
        opRevolve(context, id + "body", {
            "entities" : qSketchRegion(id + "profile"),
            "axis" : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });
