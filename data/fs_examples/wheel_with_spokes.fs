FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Wheel With Spokes" }
export const wheelWithSpokes = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Rim Radius" }
        isLength(definition.rimRadius, { (inch) : [0.5, 2.0, 12.0] } as LengthBoundSpec);

        annotation { "Name" : "Rim Thickness" }
        isLength(definition.rimThickness, { (inch) : [0.05, 0.25, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Hub Radius" }
        isLength(definition.hubRadius, { (inch) : [0.1, 0.4, 4.0] } as LengthBoundSpec);

        annotation { "Name" : "Axle Radius" }
        isLength(definition.axleRadius, { (inch) : [0.02, 0.125, 2.0] } as LengthBoundSpec);

        annotation { "Name" : "Wheel Width" }
        isLength(definition.wheelWidth, { (inch) : [0.05, 0.4, 3.0] } as LengthBoundSpec);

        annotation { "Name" : "Spoke Count" }
        isInteger(definition.spokeCount, { (unitless) : [3, 6, 16] } as IntegerBoundSpec);

        annotation { "Name" : "Spoke Width" }
        isLength(definition.spokeWidth, { (inch) : [0.03, 0.15, 1.0] } as LengthBoundSpec);
    }
    {
        // A wheel = rim ring + center hub with axle bore + patterned spokes.
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });

        var rimR = definition.rimRadius / inch;
        var rimT = definition.rimThickness / inch;
        var hubR = definition.hubRadius / inch;
        var sw = definition.spokeWidth / inch;

        // 1. Rim: ring from two concentric circles in one sketch.
        var rimSketch = newSketchOnPlane(context, id + "rimSketch", { "sketchPlane" : skPlane });
        skCircle(rimSketch, "rimOuter", { "center" : vector(0, 0) * inch, "radius" : definition.rimRadius });
        skCircle(rimSketch, "rimInner", { "center" : vector(0, 0) * inch, "radius" : definition.rimRadius - definition.rimThickness });
        skSolve(rimSketch);
        opExtrude(context, id + "rimBody", {
            "entities"  : qSketchRegion(id + "rimSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.wheelWidth
        });

        // 2. Hub: ring around the axle bore, same technique.
        var hubSketch = newSketchOnPlane(context, id + "hubSketch", { "sketchPlane" : skPlane });
        skCircle(hubSketch, "hubOuter", { "center" : vector(0, 0) * inch, "radius" : definition.hubRadius });
        skCircle(hubSketch, "axleBore", { "center" : vector(0, 0) * inch, "radius" : definition.axleRadius });
        skSolve(hubSketch);
        opExtrude(context, id + "hubBody", {
            "entities"  : qSketchRegion(id + "hubSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.wheelWidth
        });

        // 3. One spoke: thin rectangle from hub to rim.
        var spokeSketch = newSketchOnPlane(context, id + "spokeSketch", { "sketchPlane" : skPlane });
        skRectangle(spokeSketch, "spoke", {
            "firstCorner" : vector(hubR * 0.8, -sw / 2) * inch,
            "secondCorner" : vector(rimR - rimT * 0.5, sw / 2) * inch
        });
        skSolve(spokeSketch);
        opExtrude(context, id + "spokeBody", {
            "entities"  : qSketchRegion(id + "spokeSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.wheelWidth
        });

        // 4. Circular pattern of the spoke (opPattern — opPatternCircular does NOT exist).
        var patternAxis = line(skPlane.origin, skPlane.normal);
        var transforms = [];
        var instanceNames = [];
        for (var i = 1; i < definition.spokeCount; i += 1)
        {
            transforms = append(transforms, rotationAround(patternAxis, (i * 2 * PI / definition.spokeCount) * radian));
            instanceNames = append(instanceNames, "spoke" ~ i);
        }
        opPattern(context, id + "spokePattern", {
            "entities" : qCreatedBy(id + "spokeBody", EntityType.BODY),
            "transforms" : transforms,
            "instanceNames" : instanceNames
        });

        // 5. Union rim, hub, and all spokes into one wheel body.
        opBoolean(context, id + "unionWheel", {
            "tools" : qUnion([
                qCreatedBy(id + "hubBody", EntityType.BODY),
                qCreatedBy(id + "spokeBody", EntityType.BODY),
                qCreatedBy(id + "spokePattern", EntityType.BODY),
                qCreatedBy(id + "rimBody", EntityType.BODY)
            ]),
            "operationType" : BooleanOperationType.UNION
        });
    });
