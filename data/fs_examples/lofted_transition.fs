FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Square To Round Transition" }
export const squareToRoundTransition = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Base Width" }
        isLength(definition.baseWidth, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Top Radius" }
        isLength(definition.topRadius, { (inch) : [0.1, 0.75, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.25, 2.5, 18.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.baseWidth / inch;

        // Profile 1: square on the base plane.
        var baseProfile = newSketchOnPlane(context, id + "baseProfile", { "sketchPlane" : skPlane });
        skRectangle(baseProfile, "square", {
            "firstCorner" : vector(-w / 2, -w / 2) * inch,
            "secondCorner" : vector(w / 2, w / 2) * inch
        });
        skSolve(baseProfile);

        // Profile 2: circle on a parallel plane offset by the height.
        var topPlane = plane(skPlane.origin + skPlane.normal * definition.height, skPlane.normal);
        var topProfile = newSketchOnPlane(context, id + "topProfile", { "sketchPlane" : topPlane });
        skCircle(topProfile, "round", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.topRadius
        });
        skSolve(topProfile);

        // opLoft in FS 2931 takes profileSubqueries, ordered along the path.
        opLoft(context, id + "transitionBody", {
            "profileSubqueries" : [qSketchRegion(id + "baseProfile"), qSketchRegion(id + "topProfile")]
        });
    });
