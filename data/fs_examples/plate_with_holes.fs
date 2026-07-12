FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Plate With Mounting Holes" }
export const plateWithMountingHoles = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [0.5, 3.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.5, 2.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Thickness" }
        isLength(definition.thickness, { (inch) : [0.05, 0.25, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Hole Radius" }
        isLength(definition.holeRadius, { (inch) : [0.02, 0.125, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Hole Inset" }
        isLength(definition.holeInset, { (inch) : [0.1, 0.4, 4.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.width / inch;
        var h = definition.height / inch;

        var plateSketch = newSketchOnPlane(context, id + "plateSketch", { "sketchPlane" : skPlane });
        skRectangle(plateSketch, "plate", {
            "firstCorner" : vector(-w / 2, -h / 2) * inch,
            "secondCorner" : vector(w / 2, h / 2) * inch
        });
        skSolve(plateSketch);
        opExtrude(context, id + "plateBody", {
            "entities"  : qSketchRegion(id + "plateSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });

        // Holes: sketch the circles, extrude them, then SUBTRACT from the plate.
        var inset = definition.holeInset / inch;
        var holeSketch = newSketchOnPlane(context, id + "holeSketch", { "sketchPlane" : skPlane });
        skCircle(holeSketch, "leftHole", {
            "center" : vector(-w / 2 + inset, 0) * inch,
            "radius" : definition.holeRadius
        });
        skCircle(holeSketch, "rightHole", {
            "center" : vector(w / 2 - inset, 0) * inch,
            "radius" : definition.holeRadius
        });
        skSolve(holeSketch);
        opExtrude(context, id + "holeTools", {
            "entities"  : qSketchRegion(id + "holeSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
        opBoolean(context, id + "cutHoles", {
            "tools" : qCreatedBy(id + "holeTools", EntityType.BODY),
            "targets" : qCreatedBy(id + "plateBody", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    });
