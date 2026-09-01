FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Torus" }
export const torusRing = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Major Radius" }
        isLength(definition.majorRadius, { (inch) : [0.3, 1.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Tube Radius" }
        isLength(definition.tubeRadius, { (inch) : [0.02, 0.3, 4.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var majorR = definition.majorRadius / inch;

        // A torus is a circle offset from the revolve axis (never touching it),
        // revolved 360 degrees around that axis.
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : skPlane });
        skCircle(profileSketch, "tubeProfile", {
            "center" : vector(majorR, 0) * inch,
            "radius" : definition.tubeRadius
        });
        skSolve(profileSketch);

        // The revolve axis must be a Line value, never a query.
        var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
        opRevolve(context, id + "torusBody", {
            "entities"     : qSketchRegion(id + "profileSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });
