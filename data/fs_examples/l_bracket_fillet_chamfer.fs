FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "L Bracket With Fillet And Chamfer" }
export const lBracketFilletChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Leg Length" }
        isLength(definition.legLength, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Leg Height" }
        isLength(definition.legHeight, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Leg Thickness" }
        isLength(definition.legThickness, { (inch) : [0.05, 0.25, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Bracket Width" }
        isLength(definition.bracketWidth, { (inch) : [0.25, 1.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Fillet Radius" }
        isLength(definition.filletRadius, { (inch) : [0.01, 0.06, 0.5] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var legL = definition.legLength / inch;
        var legH = definition.legHeight / inch;
        var t = definition.legThickness / inch;

        // Closed L-shaped polyline profile, then one extrude for the whole bracket.
        var lSketch = newSketchOnPlane(context, id + "lSketch", { "sketchPlane" : skPlane });
        skLineSegment(lSketch, "seg1", { "start" : vector(0, 0) * inch,      "end" : vector(legL, 0) * inch });
        skLineSegment(lSketch, "seg2", { "start" : vector(legL, 0) * inch,   "end" : vector(legL, t) * inch });
        skLineSegment(lSketch, "seg3", { "start" : vector(legL, t) * inch,   "end" : vector(t, t) * inch });
        skLineSegment(lSketch, "seg4", { "start" : vector(t, t) * inch,      "end" : vector(t, legH) * inch });
        skLineSegment(lSketch, "seg5", { "start" : vector(t, legH) * inch,   "end" : vector(0, legH) * inch });
        skLineSegment(lSketch, "seg6", { "start" : vector(0, legH) * inch,   "end" : vector(0, 0) * inch });
        skSolve(lSketch);

        opExtrude(context, id + "bracketBody", {
            "entities"  : qSketchRegion(id + "lSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.bracketWidth
        });

        // Soften every two-sided edge of the bracket body.
        opFillet(context, id + "softenEdges", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "bracketBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius"   : definition.filletRadius
        });
    });
