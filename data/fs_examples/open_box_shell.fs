FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Open Top Box" }
export const openTopBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [0.5, 4.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Depth" }
        isLength(definition.depth, { (inch) : [0.5, 3.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.25, 2.0, 24.0] } as LengthBoundSpec);

        annotation { "Name" : "Wall Thickness" }
        isLength(definition.wallThickness, { (inch) : [0.02, 0.1, 1.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.width / inch;
        var d = definition.depth / inch;

        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
        skRectangle(baseSketch, "base", {
            "firstCorner" : vector(-w / 2, -d / 2) * inch,
            "secondCorner" : vector(w / 2, d / 2) * inch
        });
        skSolve(baseSketch);
        opExtrude(context, id + "boxBody", {
            "entities"  : qSketchRegion(id + "baseSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.height
        });

        // Hollow the solid and open the top by shelling away the end cap face.
        opShell(context, id + "shellBox", {
            "entities"  : qCapEntity(id + "boxBody", CapType.END, EntityType.FACE),
            "thickness" : -definition.wallThickness
        });
    });
