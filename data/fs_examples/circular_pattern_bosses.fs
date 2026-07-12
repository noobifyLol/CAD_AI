FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Disc With Patterned Bosses" }
export const discWithPatternedBosses = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Disc Radius" }
        isLength(definition.discRadius, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Disc Thickness" }
        isLength(definition.discThickness, { (inch) : [0.05, 0.25, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Boss Radius" }
        isLength(definition.bossRadius, { (inch) : [0.05, 0.2, 1.0] } as LengthBoundSpec);

        annotation { "Name" : "Boss Height" }
        isLength(definition.bossHeight, { (inch) : [0.05, 0.3, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Boss Circle Radius" }
        isLength(definition.bossCircleRadius, { (inch) : [0.25, 1.4, 10.0] } as LengthBoundSpec);

        annotation { "Name" : "Instance Count" }
        isInteger(definition.instanceCount, { (unitless) : [2, 6, 36] } as IntegerBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        // Base disc.
        var discSketch = newSketchOnPlane(context, id + "discSketch", { "sketchPlane" : skPlane });
        skCircle(discSketch, "disc", { "center" : vector(0, 0) * inch, "radius" : definition.discRadius });
        skSolve(discSketch);
        opExtrude(context, id + "discBody", {
            "entities"  : qSketchRegion(id + "discSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.discThickness
        });

        // ONE boss on top of the disc at the pattern radius.
        var bcr = definition.bossCircleRadius / inch;
        var bossPlane = plane(skPlane.origin + skPlane.normal * definition.discThickness, skPlane.normal);
        var bossSketch = newSketchOnPlane(context, id + "bossSketch", { "sketchPlane" : bossPlane });
        skCircle(bossSketch, "boss", { "center" : vector(bcr, 0) * inch, "radius" : definition.bossRadius });
        skSolve(bossSketch);
        opExtrude(context, id + "bossBody", {
            "entities"  : qSketchRegion(id + "bossSketch"),
            "direction" : bossPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.bossHeight
        });

        // CIRCULAR PATTERN: opPattern with rotationAround transforms.
        // The original boss is preserved, so build count-1 transforms starting at i = 1.
        // (opPatternCircular does NOT exist in FeatureScript.)
        var patternAxis = line(skPlane.origin, skPlane.normal);
        var transforms = [];
        var instanceNames = [];
        for (var i = 1; i < definition.instanceCount; i += 1)
        {
            var stepAngle = (i * 2 * PI / definition.instanceCount) * radian;
            transforms = append(transforms, rotationAround(patternAxis, stepAngle));
            instanceNames = append(instanceNames, "boss" ~ i);
        }
        opPattern(context, id + "bossPattern", {
            "entities" : qCreatedBy(id + "bossBody", EntityType.BODY),
            "transforms" : transforms,
            "instanceNames" : instanceNames
        });

        // Union the disc, the original boss, and every patterned boss into one body.
        opBoolean(context, id + "unionAll", {
            "tools" : qUnion([
                qCreatedBy(id + "bossBody", EntityType.BODY),
                qCreatedBy(id + "bossPattern", EntityType.BODY)
            ]),
            "targets" : qCreatedBy(id + "discBody", EntityType.BODY),
            "operationType" : BooleanOperationType.UNION
        });
    });
