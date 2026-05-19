FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Robust Spur Gear" }
export const robustSpurGear = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Number of Teeth", "Default" : "20" }
        isInteger(definition.numTeeth, {(unitless) : [6, 20, 200]});
        annotation { "Name" : "Pitch Radius", "Default" : "1 * inch" }
        isLength(definition.radius, LENGTH_BOUNDS);
        annotation { "Name" : "Bore Radius", "Default" : "0.2 * inch" }
        isLength(definition.holeRadius, NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS);
        annotation { "Name" : "Face Width", "Default" : "0.5 * inch" }
        isLength(definition.faceWidth, LENGTH_BOUNDS);
        annotation { "Name" : "Pressure Angle (degrees)", "Default" : "20" }
        isInteger(definition.pressureAngleDegrees, {(unitless) : [10, 20, 30]});
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var sketch1 = newSketchOnPlane(context, id + "sketch1", { "sketchPlane" : skPlane });

        const invPoint = function(t, rb)
        {
            return vector((rb * (cos(t) + t * sin(t))) * inch,
                          (rb * (sin(t) - t * cos(t))) * inch);
        };

        const rotPoint = function(p, a)
        {
            return vector(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
        };

        const mirrorPoint = function(p)
        {
            return vector(p.x, -p.y);
        };

        const N = definition.numTeeth;
        const rp = definition.radius / inch;
        const pa = definition.pressureAngleDegrees * PI / 180;
        const m = (2 * rp) / N;
        const ra = rp + m;
        const rd = max(rp - 1.35 * m, rp * 0.5);
        const rb = rp * cos(pa);
        const tRoot = rb >= rd ? 0 : sqrt(max(0, (rd / rb) * (rd / rb) - 1));
        const tTip = sqrt(max(0, (ra / rb) * (ra / rb) - 1));
        const hasBore = definition.holeRadius > 0 * inch;

        const rf = [
            invPoint(tRoot, rb),
            invPoint(tRoot + (tTip - tRoot) * 1 / 5, rb),
            invPoint(tRoot + (tTip - tRoot) * 2 / 5, rb),
            invPoint(tRoot + (tTip - tRoot) * 3 / 5, rb),
            invPoint(tRoot + (tTip - tRoot) * 4 / 5, rb),
            invPoint(tTip, rb)
        ];

        const lf = [
            mirrorPoint(invPoint(tTip, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 4 / 5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 3 / 5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 2 / 5, rb)),
            mirrorPoint(invPoint(tRoot + (tTip - tRoot) * 1 / 5, rb)),
            mirrorPoint(invPoint(tRoot, rb))
        ];

        for (var k = 0; k < N; k += 1)
        {
            const a = (2 * PI * k) / N;
            const rfK = [
                rotPoint(rf[0], a),
                rotPoint(rf[1], a),
                rotPoint(rf[2], a),
                rotPoint(rf[3], a),
                rotPoint(rf[4], a),
                rotPoint(rf[5], a)
            ];
            const lfK = [
                rotPoint(lf[0], a),
                rotPoint(lf[1], a),
                rotPoint(lf[2], a),
                rotPoint(lf[3], a),
                rotPoint(lf[4], a),
                rotPoint(lf[5], a)
            ];
            const tipMid = vector(ra * cos(a) * inch, ra * sin(a) * inch);
            const lfRoot = lfK[5];
            const nextA = (2 * PI * (k + 1)) / N;
            const nextRF0 = rotPoint(rf[0], nextA);
            const a1 = atan2(lfRoot.y, lfRoot.x);
            var a2 = atan2(nextRF0.y, nextRF0.x);
            if (a2 < a1)
                a2 += 2 * PI;
            const rootMid = vector(rd * cos((a1 + a2) / 2) * inch, rd * sin((a1 + a2) / 2) * inch);
            skFitSpline(sketch1, "rf" ~ k, { "points" : rfK });
            skArc(sketch1, "tip" ~ k, { "start" : rfK[5], "mid" : tipMid, "end" : lfK[0] });
            skFitSpline(sketch1, "lf" ~ k, { "points" : lfK });
            skArc(sketch1, "root" ~ k, { "start" : lfRoot, "mid" : rootMid, "end" : nextRF0 });
        }

        if (hasBore)
        {
            skCircle(sketch1, "bore", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius });
        }

        skSolve(sketch1);
        opExtrude(context, id + "extrude1", {
            "entities" : qSketchRegion(id + "sketch1", hasBore),
            "direction" : skPlane.normal,
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.faceWidth
        });
    });
