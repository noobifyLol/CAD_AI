FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Lofted Airfoil" }
export const loftedAirfoil = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Root Chord", "Default" : "3 * inch" }
        isLength(definition.rootChord, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Chord", "Default" : "1.5 * inch" }
        isLength(definition.tipChord, LENGTH_BOUNDS);
        annotation { "Name" : "Span", "Default" : "8 * inch" }
        isLength(definition.span, LENGTH_BOUNDS);
        annotation { "Name" : "Thickness Percent" }
        isInteger(definition.thicknessPercent, { (unitless) : [6, 12, 18] } as IntegerBoundSpec);
    }
    {
        var rootPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var tipPlane = plane(rootPlane.origin + rootPlane.normal * definition.span, rootPlane.normal, rootPlane.x);
        var rt = definition.rootChord / inch;
        var tt = definition.tipChord / inch;
        var tr = definition.thicknessPercent / 100;
        var rootSk = newSketchOnPlane(context, id + "root", { "sketchPlane" : rootPlane });
        skFitSpline(rootSk, "rootAirfoil", { "points" : [
            vector(0, 0) * inch,
            vector(rt * 0.25, rt * tr * 0.55) * inch,
            vector(rt * 0.55, rt * tr * 0.36) * inch,
            vector(rt, 0) * inch,
            vector(rt * 0.55, -rt * tr * 0.20) * inch,
            vector(rt * 0.25, -rt * tr * 0.25) * inch,
            vector(0, 0) * inch
        ] });
        skSolve(rootSk);
        var tipSk = newSketchOnPlane(context, id + "tip", { "sketchPlane" : tipPlane });
        skFitSpline(tipSk, "tipAirfoil", { "points" : [
            vector(0, 0) * inch,
            vector(tt * 0.25, tt * tr * 0.55) * inch,
            vector(tt * 0.55, tt * tr * 0.36) * inch,
            vector(tt, 0) * inch,
            vector(tt * 0.55, -tt * tr * 0.20) * inch,
            vector(tt * 0.25, -tt * tr * 0.25) * inch,
            vector(0, 0) * inch
        ] });
        skSolve(tipSk);
        opLoft(context, id + "wing", {
            "profileSubqueries" : [qSketchRegion(id + "root"), qSketchRegion(id + "tip")]
        });
    });
