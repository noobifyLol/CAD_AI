FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Sphere" }
export const sphereBall = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Radius" }
        isLength(definition.radius, { (inch) : [0.1, 1.0, 12.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        // Sketch the profile on the vertical plane through the placement plane's x axis
        // (sketch y = the placement normal) and revolve around that normal, so the part
        // stands upright on the selected plane instead of lying on its side.
        var profilePlane = plane(skPlane.origin, cross(skPlane.x, skPlane.normal), skPlane.x);

        var r = definition.radius / inch;

        // A sphere is a half-disk (semicircle arc + a closing line ON the axis)
        // revolved 360 degrees. The closing line must sit exactly on x = 0 so it
        // is coincident with the revolve axis.
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : profilePlane });
        skArc(profileSketch, "sphereArc", {
            "start" : vector(0, -r) * inch,
            "mid"   : vector(r, 0) * inch,
            "end"   : vector(0, r) * inch
        });
        skLineSegment(profileSketch, "axisClose", {
            "start" : vector(0, r) * inch,
            "end"   : vector(0, -r) * inch
        });
        skSolve(profileSketch);

        // The revolve axis must be a Line value, never a query.
        var revolveAxis = line(skPlane.origin, skPlane.normal);
        opRevolve(context, id + "sphereBody", {
            "entities"     : qSketchRegion(id + "profileSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });
