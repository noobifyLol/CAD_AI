FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Revolved Vase" }
export const revolvedVase = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Base Radius" }
        isLength(definition.baseRadius, { (inch) : [0.25, 1.2, 8.0] } as LengthBoundSpec);

        annotation { "Name" : "Belly Radius" }
        isLength(definition.bellyRadius, { (inch) : [0.25, 1.8, 10.0] } as LengthBoundSpec);

        annotation { "Name" : "Neck Radius" }
        isLength(definition.neckRadius, { (inch) : [0.1, 0.6, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.5, 5.0, 24.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        // Sketch the profile on the vertical plane through the placement plane's x axis
        // (sketch y = the placement normal) and revolve around that normal, so the part
        // stands upright on the selected plane instead of lying on its side.
        var profilePlane = plane(skPlane.origin, cross(skPlane.x, skPlane.normal), skPlane.x);

        var baseR = definition.baseRadius / inch;
        var bellyR = definition.bellyRadius / inch;
        var neckR = definition.neckRadius / inch;
        var ht = definition.height / inch;

        // Closed revolve profile: axis on x = 0, smooth spline on the outside,
        // straight lines closing the region back to the axis.
        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : profilePlane });
        skLineSegment(profileSketch, "axisLine", {
            "start" : vector(0, 0) * inch,
            "end"   : vector(0, ht) * inch
        });
        skFitSpline(profileSketch, "outerProfile", { "points" : [
            vector(baseR, 0) * inch,
            vector(bellyR * 0.9, ht * 0.25) * inch,
            vector(bellyR, ht * 0.45) * inch,
            vector(bellyR * 0.75, ht * 0.7) * inch,
            vector(neckR, ht * 0.9) * inch,
            vector(neckR, ht) * inch
        ] });
        skLineSegment(profileSketch, "topClose", {
            "start" : vector(neckR, ht) * inch,
            "end"   : vector(0, ht) * inch
        });
        skLineSegment(profileSketch, "baseClose", {
            "start" : vector(0, 0) * inch,
            "end"   : vector(baseR, 0) * inch
        });
        skSolve(profileSketch);

        // The revolve axis must be a Line value, never a query.
        var revolveAxis = line(skPlane.origin, skPlane.normal);
        opRevolve(context, id + "vaseBody", {
            "entities"     : qSketchRegion(id + "profileSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
    });
