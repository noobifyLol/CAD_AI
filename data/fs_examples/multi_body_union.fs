FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Base With Corner Posts" }
export const baseWithCornerPosts = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Base Width" }
        isLength(definition.baseWidth, { (inch) : [1.0, 4.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Base Depth" }
        isLength(definition.baseDepth, { (inch) : [1.0, 3.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Base Thickness" }
        isLength(definition.baseThickness, { (inch) : [0.05, 0.25, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Post Radius" }
        isLength(definition.postRadius, { (inch) : [0.05, 0.2, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Post Height" }
        isLength(definition.postHeight, { (inch) : [0.25, 1.0, 12.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.baseWidth / inch;
        var d = definition.baseDepth / inch;
        var pr = definition.postRadius / inch;

        // Base plate.
        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
        skRectangle(baseSketch, "base", {
            "firstCorner" : vector(-w / 2, -d / 2) * inch,
            "secondCorner" : vector(w / 2, d / 2) * inch
        });
        skSolve(baseSketch);
        opExtrude(context, id + "baseBody", {
            "entities"  : qSketchRegion(id + "baseSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.baseThickness
        });

        // Four corner posts in one sketch on the base top, extruded together,
        // then unioned with the base so the result is one solid body.
        var inset = pr * 2;
        var postPlane = plane(skPlane.origin + skPlane.normal * definition.baseThickness, skPlane.normal);
        var postSketch = newSketchOnPlane(context, id + "postSketch", { "sketchPlane" : postPlane });
        skCircle(postSketch, "post0", { "center" : vector(-w / 2 + inset, -d / 2 + inset) * inch, "radius" : definition.postRadius });
        skCircle(postSketch, "post1", { "center" : vector(w / 2 - inset, -d / 2 + inset) * inch, "radius" : definition.postRadius });
        skCircle(postSketch, "post2", { "center" : vector(w / 2 - inset, d / 2 - inset) * inch, "radius" : definition.postRadius });
        skCircle(postSketch, "post3", { "center" : vector(-w / 2 + inset, d / 2 - inset) * inch, "radius" : definition.postRadius });
        skSolve(postSketch);
        opExtrude(context, id + "postBodies", {
            "entities"  : qSketchRegion(id + "postSketch"),
            "direction" : postPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.postHeight
        });

        opBoolean(context, id + "unionAll", {
            "tools" : qUnion([
                qCreatedBy(id + "postBodies", EntityType.BODY),
                qCreatedBy(id + "baseBody", EntityType.BODY)
            ]),
            "operationType" : BooleanOperationType.UNION
        });
    });
