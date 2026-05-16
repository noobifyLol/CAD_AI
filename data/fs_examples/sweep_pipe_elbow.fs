FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Sweep Pipe Elbow" }
export const sweepPipeElbow = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Outer Radius", "Default" : "0.5 * inch" }
        isLength(definition.outerRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bend Radius", "Default" : "2 * inch" }
        isLength(definition.bendRadius, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var r = definition.bendRadius / inch;
        var m = r * 0.70710678;
        var pathSk = newSketchOnPlane(context, id + "path", { "sketchPlane" : skPlane });
        skArc(pathSk, "elbowArc", {
            "start" : vector(r, 0) * inch,
            "mid" : vector(m, m) * inch,
            "end" : vector(0, r) * inch
        });
        skSolve(pathSk);
        var tangentStart = cross(skPlane.normal, skPlane.x);
        var profilePlane = plane(skPlane.origin + skPlane.x * definition.bendRadius, tangentStart, skPlane.normal);
        var profileSk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : profilePlane });
        skCircle(profileSk, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skSolve(profileSk);
        opSweep(context, id + "sweep", {
            "profiles" : qSketchRegion(id + "profile"),
            "path" : qCreatedBy(id + "path", EntityType.EDGE)
        });
    });
