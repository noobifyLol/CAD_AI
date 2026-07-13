FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Hex Bolt" }
export const hexBolt = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Head Width" }
        isLength(definition.headWidth, { (inch) : [0.1, 0.44, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Head Height" }
        isLength(definition.headHeight, { (inch) : [0.05, 0.17, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Shaft Radius" }
        isLength(definition.shaftRadius, { (inch) : [0.04, 0.125, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Shaft Length" }
        isLength(definition.shaftLength, { (inch) : [0.2, 1.0, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Chamfer Width" }
        isLength(definition.chamferWidth, { (inch) : [0.005, 0.02, 0.1] } as LengthBoundSpec);
    }
    {
        // A bolt = hex head + cylindrical shaft + chamfered tip, unioned.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var hw = definition.headWidth / inch;

        // 1. Hex head: regular polygon profile extruded.
        var headSketch = newSketchOnPlane(context, id + "headSketch", { "sketchPlane" : skPlane });
        skRegularPolygon(headSketch, "hexHead", {
            "center" : vector(0, 0) * inch,
            "firstVertex" : vector(hw / 2, 0) * inch,
            "sides" : 6
        });
        skSolve(headSketch);
        opExtrude(context, id + "headBody", {
            "entities"  : qSketchRegion(id + "headSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.headHeight
        });

        // 2. Shaft: cylinder below the head.
        var shaftPlane = plane(skPlane.origin + skPlane.normal * definition.headHeight, skPlane.normal);
        var shaftSketch = newSketchOnPlane(context, id + "shaftSketch", { "sketchPlane" : shaftPlane });
        skCircle(shaftSketch, "shaft", { "center" : vector(0, 0) * inch, "radius" : definition.shaftRadius });
        skSolve(shaftSketch);
        opExtrude(context, id + "shaftBody", {
            "entities"  : qSketchRegion(id + "shaftSketch"),
            "direction" : shaftPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.shaftLength
        });

        // 3. Union head and shaft into one bolt body.
        opBoolean(context, id + "unionBolt", {
            "tools" : qCreatedBy(id + "shaftBody", EntityType.BODY),
            "targets" : qCreatedBy(id + "headBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });

        // 4. Chamfer the shaft end so threads could start cleanly.
        opChamfer(context, id + "tipChamfer", {
            "entities"    : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "headBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width"       : definition.chamferWidth
        });
    });
