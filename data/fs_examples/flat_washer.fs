FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Flat Washer" }
export const flatWasher = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Outer Radius" }
        isLength(definition.outerRadius, { (inch) : [0.3, 0.5, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Hole Radius" }
        isLength(definition.holeRadius, { (inch) : [0.02, 0.25, 0.45] } as LengthBoundSpec);

        annotation { "Name" : "Thickness" }
        isLength(definition.thickness, { (inch) : [0.005, 0.06, 1.0] } as LengthBoundSpec);
    }
    {
        // A washer is a thin ring: two concentric circles in one sketch, extruded
        // with filterInnerLoops so the inner circle becomes the hole.
        if (definition.holeRadius >= definition.outerRadius)
        {
            throw regenError("Hole Radius must be smaller than Outer Radius", ["holeRadius"]);
        }
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var washerSketch = newSketchOnPlane(context, id + "washerSketch", { "sketchPlane" : skPlane });
        skCircle(washerSketch, "outer", { "center" : vector(0, 0) * inch, "radius" : definition.outerRadius });
        skCircle(washerSketch, "hole", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        skSolve(washerSketch);
        opExtrude(context, id + "washerBody", {
            "entities"  : qSketchRegion(id + "washerSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
        opDeleteBodies(context, id + "deleteSketch", { "entities" : qCreatedBy(id + "washerSketch", EntityType.BODY) });
    });
