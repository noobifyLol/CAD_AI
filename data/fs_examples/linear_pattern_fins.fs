FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Heatsink With Linear Fins" }
export const heatsinkWithLinearFins = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Base Width" }
        isLength(definition.baseWidth, { (inch) : [0.5, 3.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Base Depth" }
        isLength(definition.baseDepth, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Base Thickness" }
        isLength(definition.baseThickness, { (inch) : [0.05, 0.2, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Fin Thickness" }
        isLength(definition.finThickness, { (inch) : [0.02, 0.08, 0.5] } as LengthBoundSpec);

        annotation { "Name" : "Fin Height" }
        isLength(definition.finHeight, { (inch) : [0.1, 0.6, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Fin Count" }
        isInteger(definition.finCount, { (unitless) : [2, 8, 40] } as IntegerBoundSpec);

        annotation { "Name" : "Fin Spacing" }
        isLength(definition.finSpacing, { (inch) : [0.05, 0.3, 2.0] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var w = definition.baseWidth / inch;
        var d = definition.baseDepth / inch;
        var ft = definition.finThickness / inch;

        // Base slab.
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

        // ONE fin at the left edge of the base top.
        var finPlane = plane(skPlane.origin + skPlane.normal * definition.baseThickness, skPlane.normal);
        var finSketch = newSketchOnPlane(context, id + "finSketch", { "sketchPlane" : finPlane });
        skRectangle(finSketch, "fin", {
            "firstCorner" : vector(-w / 2, -d / 2) * inch,
            "secondCorner" : vector(-w / 2 + ft, d / 2) * inch
        });
        skSolve(finSketch);
        opExtrude(context, id + "finBody", {
            "entities"  : qSketchRegion(id + "finSketch"),
            "direction" : finPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.finHeight
        });

        // LINEAR PATTERN: opPattern with translation transforms along the width.
        // The original fin is preserved, so build count-1 transforms starting at i = 1.
        // (opPatternLinear does NOT exist in FeatureScript.)
        var transforms = [];
        var instanceNames = [];
        for (var i = 1; i < definition.finCount; i += 1)
        {
            transforms = append(transforms, transform(skPlane.x * (definition.finSpacing * i)));
            instanceNames = append(instanceNames, "fin" ~ i);
        }
        opPattern(context, id + "finPattern", {
            "entities" : qCreatedBy(id + "finBody", EntityType.BODY),
            "transforms" : transforms,
            "instanceNames" : instanceNames
        });

        // Union base, original fin, and all patterned fins.
        opBoolean(context, id + "unionAll", {
            "tools" : qUnion([
                qCreatedBy(id + "finBody", EntityType.BODY),
                qCreatedBy(id + "finPattern", EntityType.BODY),
                qCreatedBy(id + "baseBody", EntityType.BODY)
            ]),
            "operationType" : BooleanOperationType.UNION
        });
    });
