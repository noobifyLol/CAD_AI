FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Bottle With Neck" }
export const bottleWithNeck = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Body Radius" }
        isLength(definition.bodyRadius, { (inch) : [0.5, 1.25, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Body Height" }
        isLength(definition.bodyHeight, { (inch) : [1.0, 4.0, 18.0] } as LengthBoundSpec);

        annotation { "Name" : "Neck Radius" }
        isLength(definition.neckRadius, { (inch) : [0.15, 0.45, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Neck Height" }
        isLength(definition.neckHeight, { (inch) : [0.25, 1.2, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Wall Thickness" }
        isLength(definition.wallThickness, { (inch) : [0.02, 0.08, 0.5] } as LengthBoundSpec);
    }
    {
        // A bottle is a revolved profile with a belly, a curved shoulder, and a
        // narrower neck — never a plain cylinder.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var bodyR = definition.bodyRadius / inch;
        var bodyH = definition.bodyHeight / inch;
        var neckR = definition.neckRadius / inch;
        var neckH = definition.neckHeight / inch;
        var totalH = bodyH + neckH;

        var profileSketch = newSketchOnPlane(context, id + "profileSketch", { "sketchPlane" : skPlane });
        skLineSegment(profileSketch, "axisLine", {
            "start" : vector(0, 0) * inch,
            "end"   : vector(0, totalH) * inch
        });
        skFitSpline(profileSketch, "outerProfile", { "points" : [
            vector(bodyR, 0) * inch,
            vector(bodyR, bodyH * 0.55) * inch,
            vector(bodyR * 0.92, bodyH * 0.8) * inch,
            vector(neckR * 1.4, bodyH) * inch,
            vector(neckR, bodyH + neckH * 0.35) * inch,
            vector(neckR, totalH) * inch
        ] });
        skLineSegment(profileSketch, "topClose", {
            "start" : vector(neckR, totalH) * inch,
            "end"   : vector(0, totalH) * inch
        });
        skLineSegment(profileSketch, "baseClose", {
            "start" : vector(0, 0) * inch,
            "end"   : vector(bodyR, 0) * inch
        });
        skSolve(profileSketch);

        var revolveAxis = line(skPlane.origin, cross(skPlane.normal, skPlane.x));
        opRevolve(context, id + "bottleBody", {
            "entities"     : qSketchRegion(id + "profileSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });

        // Hollow the bottle through the neck opening.
        opShell(context, id + "bottleShell", {
            "entities"  : qCapEntity(id + "bottleBody", CapType.END, EntityType.FACE),
            "thickness" : -definition.wallThickness
        });
    });
