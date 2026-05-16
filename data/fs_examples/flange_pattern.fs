FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Flange Bolt Pattern" }
export const flangeBoltPattern = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Outer radius", "Default" : "1.5 * inch" }
        isLength(definition.outerRadius, LENGTH_BOUNDS);

        annotation { "Name" : "Bore radius", "Default" : "0.45 * inch" }
        isLength(definition.boreRadius, LENGTH_BOUNDS);

        annotation { "Name" : "Thickness", "Default" : "0.3 * inch" }
        isLength(definition.thickness, LENGTH_BOUNDS);

        annotation { "Name" : "Bolt circle radius", "Default" : "1.05 * inch" }
        isLength(definition.boltCircleRadius, LENGTH_BOUNDS);

        annotation { "Name" : "Bolt hole radius", "Default" : "0.1 * inch" }
        isLength(definition.boltHoleRadius, LENGTH_BOUNDS);

        annotation { "Name" : "Bolt count", "Default" : "6" }
        isInteger(definition.boltCount, { (unitless) : [3, 6, 16] });
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var flangeSketch = newSketchOnPlane(context, id + "flangeSketch", { "sketchPlane" : skPlane });
        skCircle(flangeSketch, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skCircle(flangeSketch, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.boreRadius });
        skSolve(flangeSketch);

        opExtrude(context, id + "flangeBody", {
            "entities" : qSketchRegion(id + "flangeSketch", true),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.thickness
        });

        var boltSketch = newSketchOnPlane(context, id + "boltSketch", { "sketchPlane" : skPlane });
        var boltCircle = definition.boltCircleRadius / inch;
        for (var i = 0; i < definition.boltCount; i += 1)
        {
            var angle = 2 * PI * i / definition.boltCount;
            skCircle(boltSketch, "bolt" ~ i, {
                "center" : vector(cos(angle) * boltCircle, sin(angle) * boltCircle) * inch,
                "radius" : definition.boltHoleRadius
            });
        }
        skSolve(boltSketch);

        opExtrude(context, id + "boltCutters", {
            "entities" : qSketchRegion(id + "boltSketch"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.thickness * 1.2
        });
        opBoolean(context, id + "subtractBolts", {
            "targets" : qCreatedBy(id + "flangeBody", EntityType.BODY),
            "tools" : qCreatedBy(id + "boltCutters", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    });
