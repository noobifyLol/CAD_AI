FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "D-Shaft" }
export const dShaftKeyed = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Shaft Radius" }
        isLength(definition.shaftRadius, { (inch) : [0.05, 0.375, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Shaft Length" }
        isLength(definition.shaftLength, { (inch) : [0.2, 1.5, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Flat Depth" }
        isLength(definition.flatDepth, { (inch) : [0.01, 0.08, 1.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var r = definition.shaftRadius / inch;
        var flatDepth = definition.flatDepth / inch;
        var flatX = r - flatDepth;

        // 1. Round shaft.
        var shaftSketch = newSketchOnPlane(context, id + "shaftSketch", { "sketchPlane" : skPlane });
        skCircle(shaftSketch, "shaft", { "center" : vector(0, 0) * inch, "radius" : definition.shaftRadius });
        skSolve(shaftSketch);
        opExtrude(context, id + "shaftBody", {
            "entities"  : qSketchRegion(id + "shaftSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.shaftLength
        });

        // 2. Flat-cutting tool: a block that overlaps one side of the shaft past
        // flatX, oversized in the cross direction to guarantee a clean cut.
        var flatSketch = newSketchOnPlane(context, id + "flatSketch", { "sketchPlane" : skPlane });
        skRectangle(flatSketch, "flatTool", {
            "firstCorner"  : vector(flatX, -(r + 0.2)) * inch,
            "secondCorner" : vector(r + 0.2, r + 0.2) * inch
        });
        skSolve(flatSketch);
        opExtrude(context, id + "flatTool", {
            "entities"  : qSketchRegion(id + "flatSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.shaftLength
        });

        // 3. Subtract the flat tool from the round shaft to leave one flat face.
        opBoolean(context, id + "cutFlat", {
            "tools"         : qCreatedBy(id + "flatTool", EntityType.BODY),
            "targets"       : qCreatedBy(id + "shaftBody", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    });
