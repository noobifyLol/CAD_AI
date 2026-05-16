FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Loft Square To Circle" }
export const loftSquareToCircle = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Square Size", "Default" : "2 * inch" }
        isLength(definition.squareSize, LENGTH_BOUNDS);
        annotation { "Name" : "Circle Radius", "Default" : "0.5 * inch" }
        isLength(definition.circleRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "3 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Profile Offset", "Default" : "0 * inch" }
        isLength(definition.profileOffset, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);
    }
    {
        var basePlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var topPlane = plane(basePlane.origin + basePlane.normal * definition.height, basePlane.normal, basePlane.x);
        var halfSquare = definition.squareSize / (2 * inch);
        var skA = newSketchOnPlane(context, id + "squareProfile", { "sketchPlane" : basePlane });
        skRectangle(skA, "square", {
            "firstCorner" : vector(-halfSquare, -halfSquare) * inch,
            "secondCorner" : vector(halfSquare, halfSquare) * inch
        });
        skSolve(skA);
        var skB = newSketchOnPlane(context, id + "circleProfile", { "sketchPlane" : topPlane });
        skCircle(skB, "circle", { "center" : vector(definition.profileOffset / inch, 0) * inch, "radius" : definition.circleRadius });
        skSolve(skB);
        opLoft(context, id + "loft", {
            "profileSubqueries" : [qSketchRegion(id + "squareProfile"), qSketchRegion(id + "circleProfile")]
        });
    });
