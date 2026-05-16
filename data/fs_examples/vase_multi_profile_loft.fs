FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Vase Multi Profile Loft" }
export const vaseMultiProfileLoft = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Height", "Default" : "5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Base Radius", "Default" : "0.8 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Belly Radius", "Default" : "1.25 * inch" }
        isLength(definition.bellyRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Neck Radius", "Default" : "0.45 * inch" }
        isLength(definition.neckRadius, LENGTH_BOUNDS);
    }
    {
        var basePlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var midPlane = plane(basePlane.origin + basePlane.normal * (definition.height * 0.55), basePlane.normal, basePlane.x);
        var topPlane = plane(basePlane.origin + basePlane.normal * definition.height, basePlane.normal, basePlane.x);
        var skA = newSketchOnPlane(context, id + "baseProfile", { "sketchPlane" : basePlane });
        skCircle(skA, "base", { "center" : vector(0, 0) * inch, "radius" : definition.baseRadius });
        skSolve(skA);
        var skB = newSketchOnPlane(context, id + "bellyProfile", { "sketchPlane" : midPlane });
        skCircle(skB, "belly", { "center" : vector(0, 0) * inch, "radius" : definition.bellyRadius });
        skSolve(skB);
        var skC = newSketchOnPlane(context, id + "neckProfile", { "sketchPlane" : topPlane });
        skCircle(skC, "neck", { "center" : vector(0, 0) * inch, "radius" : definition.neckRadius });
        skSolve(skC);
        opLoft(context, id + "loft", {
            "profileSubqueries" : [qSketchRegion(id + "baseProfile"), qSketchRegion(id + "bellyProfile"), qSketchRegion(id + "neckProfile")]
        });
    });
