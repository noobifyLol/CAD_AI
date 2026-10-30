FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Swept Curved Tube" }
export const sweptCurvedTube = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Tube Radius" }
        isLength(definition.tubeRadius, { (inch) : [0.05, 0.25, 0.43] } as LengthBoundSpec);

        annotation { "Name" : "Run Length" }
        isLength(definition.runLength, { (inch) : [3.25, 4.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Rise Height" }
        isLength(definition.riseHeight, { (inch) : [0.1, 1.0, 1.6] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var run = definition.runLength / inch;
        var rise = definition.riseHeight / inch;

        // Path: one open spline wire on the base plane.
        var pathSketch = newSketchOnPlane(context, id + "pathSketch", { "sketchPlane" : skPlane });
        skFitSpline(pathSketch, "spine", { "points" : [
            vector(0, 0) * inch,
            vector(run * 0.35, rise) * inch,
            vector(run * 0.7, -rise * 0.5) * inch,
            vector(run, 0) * inch
        ] });
        skSolve(pathSketch);

        // The tube cannot be wider than the path's tightest bend radius, or the
        // swept surface folds over itself. Measure the path's curvature to check.
        var samples = [];
        for (var i = 0; i <= 64; i += 1)
        {
            samples = append(samples, i / 64);
        }
        var maxCurvature = 0 / meter;
        for (var sample in evEdgeCurvatures(context, { "edge" : qCreatedBy(id + "pathSketch", EntityType.EDGE), "parameters" : samples }))
        {
            maxCurvature = max(maxCurvature, sample.curvature);
        }
        if (definition.tubeRadius * maxCurvature >= 0.95)
        {
            throw regenError("Tube Radius is larger than the path's tightest bend; lower it or lengthen the path", ["tubeRadius"]);
        }

        // Profile: circle on a plane perpendicular to the path start.
        var profilePlane = plane(skPlane.origin, skPlane.x);
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : profilePlane });
        skCircle(profileSketch, "section", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.tubeRadius
        });
        skSolve(profileSketch);

        opSweep(context, id + "tubeBody", {
            "profiles" : qSketchRegion(id + "profileSketch"),
            "path"     : qCreatedBy(id + "pathSketch", EntityType.EDGE)
        });
    });
