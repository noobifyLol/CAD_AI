FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Cup With Handle" }
export const cupWithHandle = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Cup Radius" }
        isLength(definition.cupRadius, { (inch) : [0.5, 1.5, 8.0] } as LengthBoundSpec);

        annotation { "Name" : "Cup Height" }
        isLength(definition.cupHeight, { (inch) : [0.5, 3.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Wall Thickness" }
        isLength(definition.wallThickness, { (inch) : [0.03, 0.12, 0.5] } as LengthBoundSpec);

        annotation { "Name" : "Handle Radius" }
        isLength(definition.handleRadius, { (inch) : [0.1, 0.8, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Handle Thickness" }
        isLength(definition.handleThickness, { (inch) : [0.05, 0.2, 1.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Cup wall: solid cylinder, then shell it open from the top cap.
        var cupSketch = newSketchOnPlane(context, id + "cupSketch", { "sketchPlane" : skPlane });
        skCircle(cupSketch, "cupOuter", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.cupRadius
        });
        skSolve(cupSketch);
        opExtrude(context, id + "cupBody", {
            "entities"  : qSketchRegion(id + "cupSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.cupHeight
        });
        opShell(context, id + "cupShell", {
            "entities"  : qCapEntity(id + "cupBody", CapType.END, EntityType.FACE),
            "thickness" : -definition.wallThickness
        });

        // Handle: a ring profile beside the cup on a vertical plane,
        // extruded thin and unioned onto the wall.
        var r = definition.cupRadius / inch;
        var hh = definition.cupHeight / inch;
        var hr = definition.handleRadius / inch;
        var handlePlane = plane(skPlane.origin + skPlane.normal * (hh / 2 * inch), skPlane.x);
        var handleSketch = newSketchOnPlane(context, id + "handleSketch", { "sketchPlane" : handlePlane });
        skCircle(handleSketch, "handleOuter", {
            "center" : vector(r + hr * 0.6, 0) * inch,
            "radius" : definition.handleRadius
        });
        skCircle(handleSketch, "handleInner", {
            "center" : vector(r + hr * 0.6, 0) * inch,
            "radius" : definition.handleRadius - definition.handleThickness
        });
        skSolve(handleSketch);
        opExtrude(context, id + "handleBody", {
            "entities"  : qSketchRegion(id + "handleSketch", true),
            "direction" : handlePlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.handleThickness
        });
        opBoolean(context, id + "joinHandle", {
            "tools" : qCreatedBy(id + "handleBody", EntityType.BODY),
            "targets" : qCreatedBy(id + "cupBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });
    });
