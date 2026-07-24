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

        // Hollow the bottle by subtracting an inner revolve inset by the wall
        // thickness. (qCapEntity/opShell only work on extruded bodies, not revolves —
        // the tool profile extends past the top so the neck mouth opens cleanly.)
        var wt = definition.wallThickness / inch;
        var innerSketch = newSketchOnPlane(context, id + "innerSketch", { "sketchPlane" : skPlane });
        skLineSegment(innerSketch, "innerAxis", {
            "start" : vector(0, wt) * inch,
            "end"   : vector(0, totalH + wt) * inch
        });
        skFitSpline(innerSketch, "innerProfile", { "points" : [
            vector(bodyR - wt, wt) * inch,
            vector(bodyR - wt, bodyH * 0.55) * inch,
            vector(bodyR * 0.92 - wt, bodyH * 0.8) * inch,
            vector(neckR * 1.4 - wt, bodyH) * inch,
            vector(neckR - wt, bodyH + neckH * 0.35) * inch,
            vector(neckR - wt, totalH + wt) * inch
        ] });
        skLineSegment(innerSketch, "innerTopClose", {
            "start" : vector(neckR - wt, totalH + wt) * inch,
            "end"   : vector(0, totalH + wt) * inch
        });
        skLineSegment(innerSketch, "innerBaseClose", {
            "start" : vector(0, wt) * inch,
            "end"   : vector(bodyR - wt, wt) * inch
        });
        skSolve(innerSketch);
        opRevolve(context, id + "innerBody", {
            "entities"     : qSketchRegion(id + "innerSketch"),
            "axis"         : revolveAxis,
            "angleForward" : 2 * PI * radian
        });
        opBoolean(context, id + "hollowBottle", {
            "tools" : qCreatedBy(id + "innerBody", EntityType.BODY),
            "targets" : qCreatedBy(id + "bottleBody", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    });
