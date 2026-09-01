FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Knurled Knob" }
export const knurledKnob = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Knob Radius" }
        isLength(definition.knobRadius, { (inch) : [0.15, 0.5, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Knob Height" }
        isLength(definition.knobHeight, { (inch) : [0.1, 0.4, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Groove Depth" }
        isLength(definition.grooveDepth, { (inch) : [0.005, 0.03, 0.2] } as LengthBoundSpec);

        annotation { "Name" : "Groove Width" }
        isLength(definition.grooveWidth, { (inch) : [0.01, 0.05, 0.3] } as LengthBoundSpec);

        annotation { "Name" : "Groove Count" }
        isInteger(definition.grooveCount, { (unitless) : [6, 24, 60] } as IntegerBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var knobR = definition.knobRadius / inch;
        var grooveDepth = definition.grooveDepth / inch;
        var grooveW = definition.grooveWidth / inch;

        // 1. Base knob cylinder.
        var knobSketch = newSketchOnPlane(context, id + "knobSketch", { "sketchPlane" : skPlane });
        skCircle(knobSketch, "knobOuter", { "center" : vector(0, 0) * inch, "radius" : definition.knobRadius });
        skSolve(knobSketch);
        opExtrude(context, id + "knobBody", {
            "entities"  : qSketchRegion(id + "knobSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.knobHeight
        });

        // 2. ONE groove-cutting tool: a thin radial slot at the rim, running the
        // full height, slightly oversized past the outer surface for a clean cut.
        var grooveSketch = newSketchOnPlane(context, id + "grooveSketch", { "sketchPlane" : skPlane });
        skRectangle(grooveSketch, "groove0", {
            "firstCorner"  : vector(knobR - grooveDepth, -grooveW / 2) * inch,
            "secondCorner" : vector(knobR + 0.1, grooveW / 2) * inch
        });
        skSolve(grooveSketch);
        opExtrude(context, id + "grooveTool", {
            "entities"  : qSketchRegion(id + "grooveSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.knobHeight
        });

        // 3. CIRCULAR PATTERN the groove tool around the knob axis.
        // The original groove is preserved, so build count-1 transforms from i = 1.
        // (opPatternCircular does NOT exist in FeatureScript.)
        var patternAxis = line(skPlane.origin, skPlane.normal);
        var transforms = [];
        var instanceNames = [];
        for (var i = 1; i < definition.grooveCount; i += 1)
        {
            var stepAngle = (i * 2 * PI / definition.grooveCount) * radian;
            transforms = append(transforms, rotationAround(patternAxis, stepAngle));
            instanceNames = append(instanceNames, "groove" ~ i);
        }
        opPattern(context, id + "groovePattern", {
            "entities" : qCreatedBy(id + "grooveTool", EntityType.BODY),
            "transforms" : transforms,
            "instanceNames" : instanceNames
        });

        // 4. Subtract the original groove and every patterned groove from the knob.
        opBoolean(context, id + "cutGrooves", {
            "tools" : qUnion([
                qCreatedBy(id + "grooveTool", EntityType.BODY),
                qCreatedBy(id + "groovePattern", EntityType.BODY)
            ]),
            "targets"       : qCreatedBy(id + "knobBody", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    });
