FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Picture Frame" }
export const pictureFrame = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Outer Width" }
        isLength(definition.outerWidth, { (inch) : [1.0, 6.0, 36.0] } as LengthBoundSpec);

        annotation { "Name" : "Outer Height" }
        isLength(definition.outerHeight, { (inch) : [1.0, 4.0, 36.0] } as LengthBoundSpec);

        annotation { "Name" : "Border Width" }
        isLength(definition.borderWidth, { (inch) : [0.1, 0.5, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Frame Depth" }
        isLength(definition.frameDepth, { (inch) : [0.05, 0.3, 2.0] } as LengthBoundSpec);
    }
    {
        // A frame is a rectangular RING: outer and inner rectangles in the SAME
        // sketch, so one extrude produces the border with the middle open.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.outerWidth / inch;
        var h = definition.outerHeight / inch;
        var b = definition.borderWidth / inch;

        var frameSketch = newSketchOnPlane(context, id + "frameSketch", { "sketchPlane" : skPlane });
        skRectangle(frameSketch, "outerRect", {
            "firstCorner" : vector(-w / 2, -h / 2) * inch,
            "secondCorner" : vector(w / 2, h / 2) * inch
        });
        skRectangle(frameSketch, "innerRect", {
            "firstCorner" : vector(-w / 2 + b, -h / 2 + b) * inch,
            "secondCorner" : vector(w / 2 - b, h / 2 - b) * inch
        });
        skSolve(frameSketch);

        opExtrude(context, id + "frameBody", {
            "entities"  : qSketchRegion(id + "frameSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.frameDepth
        });
    });
