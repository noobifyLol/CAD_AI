FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Stepped Shaft With Chamfer" }
export const steppedShaftWithChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Major Radius" }
        isLength(definition.majorRadius, { (inch) : [0.1, 0.5, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Major Length" }
        isLength(definition.majorLength, { (inch) : [0.25, 1.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Minor Radius" }
        isLength(definition.minorRadius, { (inch) : [0.05, 0.3, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Minor Length" }
        isLength(definition.minorLength, { (inch) : [0.25, 1.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Chamfer Width" }
        isLength(definition.chamferWidth, { (inch) : [0.005, 0.03, 0.25] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Large diameter section.
        var majorSketch = newSketchOnPlane(context, id + "majorSketch", { "sketchPlane" : skPlane });
        skCircle(majorSketch, "major", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.majorRadius
        });
        skSolve(majorSketch);
        opExtrude(context, id + "majorBody", {
            "entities"  : qSketchRegion(id + "majorSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.majorLength
        });

        // Smaller diameter section stacked on top, then unioned into one shaft.
        var stepPlane = plane(skPlane.origin + skPlane.normal * definition.majorLength, skPlane.normal);
        var minorSketch = newSketchOnPlane(context, id + "minorSketch", { "sketchPlane" : stepPlane });
        skCircle(minorSketch, "minor", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.minorRadius
        });
        skSolve(minorSketch);
        opExtrude(context, id + "minorBody", {
            "entities"  : qSketchRegion(id + "minorSketch"),
            "direction" : stepPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.minorLength
        });
        opBoolean(context, id + "unionShaft", {
            "tools" : qCreatedBy(id + "minorBody", EntityType.BODY),
            "targets" : qCreatedBy(id + "majorBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });

        // Break the sharp end edges with a chamfer.
        opChamfer(context, id + "endChamfer", {
            "entities"    : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "majorBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width"       : definition.chamferWidth
        });
    });
