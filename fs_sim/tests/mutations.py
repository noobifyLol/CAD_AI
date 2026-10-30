"""Mutation tests: one known Onshape mistake at a time must be rejected, and the
unmutated feature must build. Run: python -m fs_sim.tests.mutations"""
import sys

from fs_sim.run import run_feature

BASE = '''FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Mutation Base" }
export const mutationBase = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;

        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [0.5, 2.0, 10.0] } as LengthBoundSpec);

        annotation { "Name" : "Count" }
        isInteger(definition.count, { (unitless) : [2, 4, 12] } as IntegerBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location)
            ? plane(WORLD_ORIGIN, Z_DIRECTION)
            : evPlane(context, { "face" : definition.location });
        var w = definition.width / inch;
        var baseSketch = newSketchOnPlane(context, id + "baseSketch", { "sketchPlane" : skPlane });
        skRectangle(baseSketch, "base", { "firstCorner" : vector(-w / 2, -w / 2) * inch, "secondCorner" : vector(w / 2, w / 2) * inch });
        skCircle(baseSketch, "hole", { "center" : vector(0, 0) * inch, "radius" : definition.width / 8 });
        skSolve(baseSketch);
        opExtrude(context, id + "baseBody", {
            "entities"  : qSketchRegion(id + "baseSketch", true),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.width / 4
        });
        var postSketch = newSketchOnPlane(context, id + "postSketch", { "sketchPlane" : skPlane });
        skCircle(postSketch, "post", { "center" : vector(w * 0.35, 0) * inch, "radius" : definition.width / 20 });
        skSolve(postSketch);
        opExtrude(context, id + "postBody", {
            "entities"  : qSketchRegion(id + "postSketch"),
            "direction" : skPlane.normal,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.width / 2
        });
        var transforms = [];
        var names = [];
        for (var i = 1; i < definition.count; i += 1)
        {
            transforms = append(transforms, rotationAround(line(skPlane.origin, skPlane.normal), (i * 2 * PI / definition.count) * radian));
            names = append(names, "post" ~ i);
        }
        opPattern(context, id + "postPattern", { "entities" : qCreatedBy(id + "postBody", EntityType.BODY), "transforms" : transforms, "instanceNames" : names });
        opBoolean(context, id + "join", {
            "tools" : qUnion([qCreatedBy(id + "baseBody", EntityType.BODY), qCreatedBy(id + "postBody", EntityType.BODY), qCreatedBy(id + "postPattern", EntityType.BODY)]),
            "operationType" : BooleanOperationType.UNION
        });
        opFillet(context, id + "round", {
            "entities" : qEdgeTopologyFilter(qOwnedByBody(qCreatedBy(id + "baseBody", EntityType.BODY), EntityType.EDGE), EdgeTopology.TWO_SIDED),
            "radius" : definition.width / 100
        });
    });
'''

MUTATIONS = [
    ("unitless sketch point", 'vector(-w / 2, -w / 2) * inch', 'vector(-w / 2, -w / 2)'),
    ("number instead of a length radius", '"radius" : definition.width / 8', '"radius" : 0.25'),
    ("units applied twice", '"radius" : definition.width / 8', '"radius" : definition.width / 8 * inch'),
    ("missing skSolve", '        skSolve(baseSketch);\n', ''),
    ("nonexistent pattern function", 'opPattern(context, id + "postPattern"', 'opPatternCircular(context, id + "postPattern"'),
    ("+ used for string concatenation", '"post" ~ i', '"post" + i'),
    ("typo in sketch id", 'qSketchRegion(id + "postSketch")', 'qSketchRegion(id + "postSktch")'),
    ("undeclared variable", 'var w = definition.width / inch;', 'var width = definition.width / inch;'),
    ("duplicate operation id", 'opExtrude(context, id + "postBody"', 'opExtrude(context, id + "baseBody"'),
    ("duplicate sketch entity id", '        skSolve(baseSketch);', '        skCircle(baseSketch, "hole", { "center" : vector(w / 4, 0) * inch, "radius" : definition.width / 20 });\n        skSolve(baseSketch);'),
    ("default outside bounds", '[0.5, 2.0, 10.0]', '[0.5, 20.0, 10.0]'),
    ("bound spec without type", '{ (inch) : [0.5, 2.0, 10.0] } as LengthBoundSpec', '{ (inch) : [0.5, 2.0, 10.0] }'),
    ("array .length", 'i < definition.count', 'i < names.length + 3'),
    ("UNION with targets", '"operationType" : BooleanOperationType.UNION', '"targets" : qCreatedBy(id + "baseBody", EntityType.BODY),\n            "operationType" : BooleanOperationType.UNION'),
    ("axis given as a query", 'rotationAround(line(skPlane.origin, skPlane.normal)', 'rotationAround(qCreatedBy(id + "baseBody", EntityType.EDGE)'),
    ("fillet larger than the part", '"radius" : definition.width / 100', '"radius" : definition.width'),
    ("extrude with zero depth", '"endDepth"  : definition.width / 4', '"endDepth"  : 0 * inch'),
    ("non-boolean condition", 'i < definition.count', 'definition.count'),
    ("missing semicolon", 'var w = definition.width / inch;', 'var w = definition.width / inch'),
    ("evPlane on an empty selection", '? plane(WORLD_ORIGIN, Z_DIRECTION)', '? evPlane(context, { "face" : definition.location })'),
]


def main():
    failures = 0
    base = run_feature(BASE)
    base.pop("_shapes", None)
    if base["ok"] and len(base["parts"]) == 1:
        print(f"PASS base feature builds ({base['parts'][0]['volume_in3']} in^3)")
    else:
        failures += 1
        print("FAIL base feature should build:", base["errors"], base["gaps"], len(base["parts"]))
    for label, old, new in MUTATIONS:
        if old not in BASE:
            failures += 1
            print(f"FAIL {label}: mutation anchor not found")
            continue
        result = run_feature(BASE.replace(old, new, 1))
        result.pop("_shapes", None)
        caught = not result["ok"] and result["errors"] and not result["gaps"]
        if caught:
            print(f"PASS rejects {label}: {result['errors'][0][:110]}")
        else:
            failures += 1
            why = result["gaps"][0][:120] if result["gaps"] else f"ok={result['ok']} parts={len(result['parts'])}"
            print(f"FAIL should reject {label} — {why}")
    print("\nALL MUTATION CHECKS PASSED" if not failures else f"\n{failures} MUTATION CHECK(S) FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
