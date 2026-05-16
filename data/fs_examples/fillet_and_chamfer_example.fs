FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Fillet And Chamfer Block" }
export const filletAndChamferBlock = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Width", "Default" : "2 * inch" }
        isLength(definition.width, LENGTH_BOUNDS);
        annotation { "Name" : "Depth", "Default" : "1.25 * inch" }
        isLength(definition.depth, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "0.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Fillet Radius", "Default" : "0.08 * inch" }
        isLength(definition.filletRadius, LENGTH_BOUNDS);
        annotation { "Name" : "Chamfer Width", "Default" : "0.04 * inch" }
        isLength(definition.chamferWidth, LENGTH_BOUNDS);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var w = definition.width / (2 * inch);
        var d = definition.depth / (2 * inch);
        var sk = newSketchOnPlane(context, id + "profile", { "sketchPlane" : skPlane });
        skRectangle(sk, "rect", { "firstCorner" : vector(-w, -d) * inch, "secondCorner" : vector(w, d) * inch });
        skSolve(sk);
        opExtrude(context, id + "body", {
            "entities" : qSketchRegion(id + "profile"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        opFillet(context, id + "fillet", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius" : definition.filletRadius
        });
        opChamfer(context, id + "chamfer", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "body", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width" : definition.chamferWidth
        });
    });
