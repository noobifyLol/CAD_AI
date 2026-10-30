FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Block With Through Hole" }
export const blockWithThroughHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [0.6, 1.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Depth" }
        isLength(definition.depth, { (inch) : [0.6, 1.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.1, 1.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Hole Radius" }
        isLength(definition.holeRadius, { (inch) : [0.01, 0.25, 0.45] } as LengthBoundSpec);
    }
    {
        // A cube/block with a centered hole straight through it: the square and the
        // hole circle share one sketch, so filterInnerLoops leaves the hole empty.
        if (definition.holeRadius * 2 >= min(definition.width, definition.depth))
        {
            throw regenError("The hole must be smaller than the block", ["holeRadius"]);
        }
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.width / inch;
        var d = definition.depth / inch;
        var blockSketch = newSketchOnPlane(context, id + "blockSketch", { "sketchPlane" : skPlane });
        skRectangle(blockSketch, "block", {
            "firstCorner"  : vector(-w / 2, -d / 2) * inch,
            "secondCorner" : vector(w / 2, d / 2) * inch
        });
        skCircle(blockSketch, "hole", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        skSolve(blockSketch);
        opExtrude(context, id + "blockBody", {
            "entities"  : qSketchRegion(id + "blockSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.height
        });
        opDeleteBodies(context, id + "deleteSketch", { "entities" : qCreatedBy(id + "blockSketch", EntityType.BODY) });
    });
