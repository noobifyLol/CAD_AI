FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Wedge Ramp" }
export const wedgeRamp = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Ramp Length" }
        isLength(definition.rampLength, { (inch) : [0.5, 4.0, 36.0] } as LengthBoundSpec);

        annotation { "Name" : "Ramp Height" }
        isLength(definition.rampHeight, { (inch) : [0.25, 1.5, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Ramp Width" }
        isLength(definition.rampWidth, { (inch) : [0.25, 2.0, 36.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var rampL = definition.rampLength / inch;
        var rampH = definition.rampHeight / inch;

        // Closed right-triangle profile (flat base, vertical back, sloped
        // hypotenuse), then one extrude for the whole wedge.
        var rampSketch = newSketchOnPlane(context, id + "rampSketch", { "sketchPlane" : skPlane });
        skLineSegment(rampSketch, "base", {
            "start" : vector(0, 0) * inch,
            "end"   : vector(rampL, 0) * inch
        });
        skLineSegment(rampSketch, "back", {
            "start" : vector(rampL, 0) * inch,
            "end"   : vector(rampL, rampH) * inch
        });
        skLineSegment(rampSketch, "slope", {
            "start" : vector(rampL, rampH) * inch,
            "end"   : vector(0, 0) * inch
        });
        skSolve(rampSketch);

        opExtrude(context, id + "rampBody", {
            "entities"  : qSketchRegion(id + "rampSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.rampWidth
        });
    });
