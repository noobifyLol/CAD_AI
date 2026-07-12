FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Cylinder With Bore" }
export const cylinderWithBore = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Outer Radius" }
        isLength(definition.outerRadius, { (inch) : [0.1, 1.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Bore Radius" }
        isLength(definition.boreRadius, { (inch) : [0.02, 0.25, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.1, 1.5, 24.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Concentric circles in ONE sketch: the region between them extrudes
        // into a tube, so no boolean subtraction is needed for the bore.
        var ringSketch = newSketchOnPlane(context, id + "ringSketch", { "sketchPlane" : skPlane });
        skCircle(ringSketch, "outer", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.outerRadius
        });
        skCircle(ringSketch, "inner", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.boreRadius
        });
        skSolve(ringSketch);

        opExtrude(context, id + "tubeBody", {
            "entities"  : qSketchRegion(id + "ringSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.height
        });
    });
