FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Pen With Tip And Clip" }
export const penWithTipAndClip = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Barrel Radius" }
        isLength(definition.barrelRadius, { (inch) : [0.1, 0.22, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Barrel Length" }
        isLength(definition.barrelLength, { (inch) : [1.0, 4.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Tip Length" }
        isLength(definition.tipLength, { (inch) : [0.2, 0.8, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Clip Length" }
        isLength(definition.clipLength, { (inch) : [0.3, 1.2, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Clip Width" }
        isLength(definition.clipWidth, { (inch) : [0.05, 0.15, 0.5] } as LengthBoundSpec);
    }
    {
        // A pen is NOT one stretched primitive. Decompose it into its
        // recognizable components: barrel + tapered writing tip + pocket clip.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var r = definition.barrelRadius / inch;

        // 1. Barrel: cylinder along the plane normal.
        var barrelSketch = newSketchOnPlane(context, id + "barrelSketch", { "sketchPlane" : skPlane });
        skCircle(barrelSketch, "barrel", { "center" : vector(0, 0) * inch, "radius" : definition.barrelRadius });
        skSolve(barrelSketch);
        opExtrude(context, id + "barrelBody", {
            "entities"  : qSketchRegion(id + "barrelSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.barrelLength
        });

        // 2. Tapered tip: loft from the barrel end circle down to a small point circle.
        var tipStartPlane = plane(skPlane.origin + skPlane.normal * definition.barrelLength, skPlane.normal);
        var tipStartSketch = newSketchOnPlane(context, id + "tipStartSketch", { "sketchPlane" : tipStartPlane });
        skCircle(tipStartSketch, "tipBase", { "center" : vector(0, 0) * inch, "radius" : definition.barrelRadius });
        skSolve(tipStartSketch);

        var tipEndPlane = plane(skPlane.origin + skPlane.normal * (definition.barrelLength + definition.tipLength), skPlane.normal);
        var tipEndSketch = newSketchOnPlane(context, id + "tipEndSketch", { "sketchPlane" : tipEndPlane });
        skCircle(tipEndSketch, "tipPoint", { "center" : vector(0, 0) * inch, "radius" : definition.barrelRadius * 0.12 });
        skSolve(tipEndSketch);

        opLoft(context, id + "tipBody", {
            "profileSubqueries" : [qSketchRegion(id + "tipStartSketch"), qSketchRegion(id + "tipEndSketch")]
        });

        // 3. Pocket clip: thin bar lying along the barrel side near the top end.
        var cw = definition.clipWidth / inch;
        var clipSketch = newSketchOnPlane(context, id + "clipSketch", { "sketchPlane" : skPlane });
        skRectangle(clipSketch, "clip", {
            "firstCorner" : vector(r, -cw / 2) * inch,
            "secondCorner" : vector(r + cw, cw / 2) * inch
        });
        skSolve(clipSketch);
        opExtrude(context, id + "clipBody", {
            "entities"  : qSketchRegion(id + "clipSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.clipLength
        });

        // Union all pen components into one body.
        opBoolean(context, id + "unionPen", {
            "tools" : qUnion([
                qCreatedBy(id + "tipBody", EntityType.BODY),
                qCreatedBy(id + "clipBody", EntityType.BODY)
            ]),
            "targets" : qCreatedBy(id + "barrelBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });
    });
