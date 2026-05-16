FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Open Top Shell Enclosure" }
export const openTopShellEnclosure = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Width", "Default" : "4 * inch" }
        isLength(definition.width, LENGTH_BOUNDS);
        annotation { "Name" : "Depth", "Default" : "3 * inch" }
        isLength(definition.depth, LENGTH_BOUNDS);
        annotation { "Name" : "Height", "Default" : "1.5 * inch" }
        isLength(definition.height, LENGTH_BOUNDS);
        annotation { "Name" : "Wall Thickness", "Default" : "0.1 * inch" }
        isLength(definition.wallThickness, LENGTH_BOUNDS);
        annotation { "Name" : "Open Top" }
        definition.openTop is boolean;
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var halfWidth = definition.width / (2 * inch);
        var halfDepth = definition.depth / (2 * inch);
        var sk = newSketchOnPlane(context, id + "base", { "sketchPlane" : skPlane });
        skRectangle(sk, "outer", {
            "firstCorner" : vector(-halfWidth, -halfDepth) * inch,
            "secondCorner" : vector(halfWidth, halfDepth) * inch
        });
        skSolve(sk);
        opExtrude(context, id + "block", {
            "entities" : qSketchRegion(id + "base"),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.height
        });
        if (definition.openTop)
        {
            opShell(context, id + "shell", {
                "entities" : qCapEntity(id + "block", CapType.END, EntityType.FACE),
                "thickness" : -definition.wallThickness
            });
        }
    });
