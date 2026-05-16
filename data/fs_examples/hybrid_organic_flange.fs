FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Hybrid Organic Flange" }
export const hybridOrganicFlange = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Base Radius", "Default" : "0.65 * inch" }
        isLength(definition.baseRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "3.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Tip Radius", "Default" : "0.08 * inch" }
        isLength(definition.tipRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Flange Radius", "Default" : "1.25 * inch" }
        isLength(definition.flangeRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bolt Circle Radius", "Default" : "0.9 * inch" }
        isLength(definition.boltCircleRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Bolt Radius", "Default" : "0.09 * inch" }
        isLength(definition.boltRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Flange Thickness", "Default" : "0.2 * inch" }
        isLength(definition.flangeThickness, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var axisDirection = cross(skPlane.normal, skPlane.x);
        var b = definition.baseRadius / inch;
        var h = definition.height / inch;
        var t = definition.tipRadius / inch;
        var bodySk = newSketchOnPlane(context, id + "bodyProfile", { "sketchPlane" : skPlane });
        skLineSegment(bodySk, "axis", { "start" : vector(0, 0) * inch, "end" : vector(0, h) * inch });
        skFitSpline(bodySk, "skin", { "points" : [
            vector(b, 0) * inch,
            vector(b * 0.9, h * 0.25) * inch,
            vector(b * 0.62, h * 0.52) * inch,
            vector(b * 0.34, h * 0.75) * inch,
            vector(t, h) * inch
        ] });
        skLineSegment(bodySk, "top", { "start" : vector(t, h) * inch, "end" : vector(0, h) * inch });
        skLineSegment(bodySk, "base", { "start" : vector(0, 0) * inch, "end" : vector(b, 0) * inch });
        skSolve(bodySk);
        opRevolve(context, id + "organicBody", {
            "entities" : qSketchRegion(id + "bodyProfile"),
            "axis" : line(skPlane.origin, axisDirection),
            "angleForward" : 2 * PI * radian
        });
        var flangePlane = plane(skPlane.origin, axisDirection, skPlane.x);
        var bc = definition.boltCircleRadius / inch;
        var flangeSk = newSketchOnPlane(context, id + "flangeProfile", { "sketchPlane" : flangePlane });
        skCircle(flangeSk, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.flangeRadius });
        skCircle(flangeSk, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.baseRadius });
        skCircle(flangeSk, "bolt0", { "center" : vector(bc, 0) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt1", { "center" : vector(0, bc) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt2", { "center" : vector(-bc, 0) * inch, "radius" : definition.boltRadius });
        skCircle(flangeSk, "bolt3", { "center" : vector(0, -bc) * inch, "radius" : definition.boltRadius });
        skSolve(flangeSk);
        opExtrude(context, id + "flange", {
            "entities" : qSketchRegion(id + "flangeProfile", true),
            "direction" : axisDirection,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.flangeThickness
        });
        opBoolean(context, id + "join", {
            "tools" : qCreatedBy(id + "flange", EntityType.BODY),
            "targets" : qCreatedBy(id + "organicBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });
    });
