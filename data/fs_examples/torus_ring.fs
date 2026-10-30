FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Torus" }
export const torusRing = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Major Radius" }
        isLength(definition.majorRadius, { (inch) : [0.35, 1.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Tube Radius" }
        isLength(definition.tubeRadius, { (inch) : [0.02, 0.3, 1.4] } as LengthBoundSpec);
    }
    {
        if (definition.tubeRadius >= definition.majorRadius)
        {
            throw regenError("Tube Radius must be smaller than Major Radius", ["tubeRadius"]);
        }
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        // Sketch the profile on the vertical plane through the placement plane's x axis
        // (sketch y = the placement normal) and revolve around that normal, so the part
        // stands upright on the selected plane instead of lying on its side.
        var profilePlane = plane(skPlane.origin, cross(skPlane.x, skPlane.normal), skPlane.x);

        var majorR = definition.majorRadius / inch;

        // A torus is a circle offset from the revolve axis (never touching it),
        // revolved 360 degrees around that axis.
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : profilePlane });
        skCircle(profileSketch, "tubeProfile", {
            "center" : vector(majorR, 0) * inch,
            "radius" : definition.tubeRadius
        });
        skSolve(profileSketch);

        // The revolve axis must be a Line value, never a query.
        var revolveAxis = line(skPlane.origin, skPlane.normal);
        opRevolve(context, id + "torusBody", {
            "entities"     : qSketchRegion(id + "profileSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });
