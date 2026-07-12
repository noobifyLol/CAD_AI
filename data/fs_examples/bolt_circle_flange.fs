FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Bolt Circle Flange" }
export const boltCircleFlange = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Flange Radius" }
        isLength(definition.flangeRadius, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Center Bore Radius" }
        isLength(definition.boreRadius, { (inch) : [0.05, 0.5, 6.0] } as LengthBoundSpec);

        annotation { "Name" : "Bolt Hole Radius" }
        isLength(definition.boltHoleRadius, { (inch) : [0.02, 0.125, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Bolt Circle Radius" }
        isLength(definition.boltCircleRadius, { (inch) : [0.25, 1.4, 10.0] } as LengthBoundSpec);

        annotation { "Name" : "Bolt Count" }
        isInteger(definition.boltCount, { (unitless) : [2, 6, 24] } as IntegerBoundSpec);

        annotation { "Name" : "Thickness" }
        isLength(definition.thickness, { (inch) : [0.05, 0.375, 3.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Disc, center bore, and every bolt hole live in ONE sketch, so a single
        // extrude produces the finished flange with all holes already cut.
        var bcr = definition.boltCircleRadius / inch;
        var flangeSketch = newSketchOnPlane(context, id + "flangeSketch", { "sketchPlane" : skPlane });
        skCircle(flangeSketch, "rim", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.flangeRadius
        });
        skCircle(flangeSketch, "centerBore", {
            "center" : vector(0, 0) * inch,
            "radius" : definition.boreRadius
        });
        for (var i = 0; i < definition.boltCount; i += 1)
        {
            // String entity ids are built with the ~ concatenation operator.
            var boltAngle = (i * 2 * PI / definition.boltCount) * radian;
            var bx = cos(boltAngle) * bcr;
            var by = sin(boltAngle) * bcr;
            skCircle(flangeSketch, "bolt" ~ i, {
                "center" : vector(bx, by) * inch,
                "radius" : definition.boltHoleRadius
            });
        }
        skSolve(flangeSketch);

        opExtrude(context, id + "flangeBody", {
            "entities"  : qSketchRegion(id + "flangeSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
    });
