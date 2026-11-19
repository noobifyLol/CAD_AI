// Regression test for the part-kit repairs in partKit.js and the translation() rewrite:
//   node scripts/kit_fix_check.mjs
import { appendAutoMerge, autoFixKitTargets, guardFinishingOps } from "../partKit.js";
import { autoFixRuntimeTypes } from "../featureScriptGeometry.js";

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) console.log(`PASS ${name}`);
  else { failures += 1; console.log(`FAIL ${name}\n     got  ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`); }
}

const lines = (...rows) => rows.join("\n");

// 1) cutting from a piece that was merged into another one
check("cut target absorbed by a merge",
  autoFixKitTargets(lines(
    'kitMerge(context, id + "join", [id + "main", id + "lid"]);',
    'kitCut(context, id + "holes", id + "lid", [id + "h1"]);',
  )).code,
  lines(
    'kitMerge(context, id + "join", [id + "main", id + "lid"]);',
    'kitCut(context, id + "holes", id + "main", [id + "h1"]);',
  ));

// 2) cutting from the merge operation's own id
check("cut target is the merge id",
  autoFixKitTargets(lines(
    'kitMerge(context, id + "join", [id + "main", id + "lid"]);',
    'kitCut(context, id + "grille", id + "join", [id + "slot1", id + "slot2"]);',
  )).code,
  lines(
    'kitMerge(context, id + "join", [id + "main", id + "lid"]);',
    'kitCut(context, id + "grille", id + "main", [id + "slot1", id + "slot2"]);',
  ));

// 3) merges of merges
check("chained merges",
  autoFixKitTargets(lines(
    'kitMerge(context, id + "m1", [id + "a", id + "b"]);',
    'kitMerge(context, id + "m2", [id + "c", id + "b"]);',
    'kitCut(context, id + "cut", id + "a", [id + "h"]);',
  )).code,
  lines(
    'kitMerge(context, id + "m1", [id + "a", id + "b"]);',
    'kitMerge(context, id + "m2", [id + "c", id + "a"]);',
    'kitCut(context, id + "cut", id + "c", [id + "h"]);',
  ));

// 4) a piece merged twice is listed once
check("duplicate after merge",
  autoFixKitTargets(lines(
    'kitMerge(context, id + "m1", [id + "main", id + "lid"]);',
    'kitMerge(context, id + "m2", [id + "main", id + "lid", id + "foot"]);',
  )).code,
  lines(
    'kitMerge(context, id + "m1", [id + "main", id + "lid"]);',
    'kitMerge(context, id + "m2", [id + "main", id + "foot"]);',
  ));

// 5) correct code is untouched (cut before merge, loop ids left alone)
const good = lines(
  'kitCut(context, id + "hollow", id + "main", [id + "pocket"]);',
  'kitMerge(context, id + "join", [id + "main", id + "divider", id + ("rib" ~ i)]);',
  'kitCut(context, id + "holes", id + "main", [id + "h1"]);',
);
check("correct code unchanged", autoFixKitTargets(good).code, good);
check("correct code: nothing fixed", autoFixKitTargets(good).fixed, 0);

// 6) fillets / chamfers are wrapped once
const fillet = lines(
  "        opFillet(context, id + \"round\", {",
  "            \"entities\" : qCreatedBy(id + \"main\", EntityType.EDGE),",
  "            \"radius\" : 0.1 * inch",
  "        });",
);
const wrapped = guardFinishingOps(fillet);
check("fillet wrapped in try silent", wrapped.startsWith("        try silent\n        {\n            opFillet("), true);
check("wrapped fillet keeps its arguments", wrapped.includes("\"radius\" : 0.1 * inch"), true);
check("not wrapped twice", guardFinishingOps(wrapped), wrapped);
check("other statements untouched", guardFinishingOps("    opExtrude(context, id + \"e\", {});"), "    opExtrude(context, id + \"e\", {});");

// 7) translation() does not exist
check("translation(x, y, z) -> transform(vector(...))",
  autoFixRuntimeTypes('opTransform(context, id + "move", { "bodies" : q, "transform" : translation(0 * inch, 0 * inch, 1 * inch) });').code,
  'opTransform(context, id + "move", { "bodies" : q, "transform" : transform(vector(0 * inch, 0 * inch, 1 * inch)) });');
check("translation(v) -> transform(v)",
  autoFixRuntimeTypes('var t = translation(offset);').code,
  "var t = transform(offset);");

// 7b) vector fields and name joins
check("loop vector .x/.y -> [0]/[1]",
  autoFixRuntimeTypes(lines(
    "for (var off in [vector(1, 0), vector(-1, 0)])",
    "{",
    '    kitCylinder(context, id + ("rib" ~ off.x), skPlane, off.x, off.y, 0, 0.1, 1);',
    "}",
  )).code,
  lines(
    "for (var off in [vector(1, 0), vector(-1, 0)])",
    "{",
    '    kitCylinder(context, id + ("rib" ~ off[0]), skPlane, off[0], off[1], 0, 0.1, 1);',
    "}",
  ));
check("plane .x and map .x untouched",
  autoFixRuntimeTypes('var dims = { "x" : 1 };\nvar a = dims.x + 1;\nvar p = plane(WORLD_ORIGIN, Z_DIRECTION);\nvar d = p.x;').code,
  'var dims = { "x" : 1 };\nvar a = dims.x + 1;\nvar p = plane(WORLD_ORIGIN, Z_DIRECTION);\nvar d = p.x;');
check("skPlane.origin.z -> skPlane.origin[2]",
  autoFixRuntimeTypes("var h = skPlane.origin.z;").code,
  "var h = skPlane.origin[2];");
check('id + "rib" ~ i -> id + ("rib" ~ i)',
  autoFixRuntimeTypes('kitBox(context, id + "rib" ~ i, skPlane, 0, 0, 0, 1, 1, 1);').code,
  'kitBox(context, id + ("rib" ~ i), skPlane, 0, 0, 0, 1, 1, 1);');
check("id + (\"rib\" ~ i) untouched",
  autoFixRuntimeTypes('kitBox(context, id + ("rib" ~ i), skPlane, 0, 0, 0, 1, 1, 1);').code,
  'kitBox(context, id + ("rib" ~ i), skPlane, 0, 0, 0, 1, 1, 1);');

// 7c) sketch faces as profiles -> qSketchRegion
check("loft profile qCreatedBy(sketch, FACE) -> qSketchRegion",
  autoFixRuntimeTypes(lines(
    'var s1 = newSketchOnPlane(context, id + "base", { "sketchPlane" : skPlane });',
    'opLoft(context, id + "loft", { "profileSubqueries" : [qCreatedBy(id + "base", EntityType.FACE), qCreatedBy(id + "top", EntityType.FACE)] });',
  )).code,
  lines(
    'var s1 = newSketchOnPlane(context, id + "base", { "sketchPlane" : skPlane });',
    'opLoft(context, id + "loft", { "profileSubqueries" : [qSketchRegion(id + "base"), qCreatedBy(id + "top", EntityType.FACE)] });',
  ));

// 7d) unitless line origin, positional fCylinder
check("line(vector(0, 0, 0), dir) -> origin in inches",
  autoFixRuntimeTypes("var axis = line(vector(0, 0, 0), vector(0, 0, 1));").code,
  "var axis = line(vector(0, 0, 0) * inch, vector(0, 0, 1));");
check("line with a unit origin untouched",
  autoFixRuntimeTypes("var axis = line(skPlane.origin, skPlane.normal);").code,
  "var axis = line(skPlane.origin, skPlane.normal);");
check("positional fCylinder -> map",
  autoFixRuntimeTypes('fCylinder(context, id + "post", bottom, top, 0.25 * inch);').code,
  'fCylinder(context, id + "post", { "bottomCenter" : bottom, "topCenter" : top, "radius" : 0.25 * inch });');
check("fCylinder with a map untouched",
  autoFixRuntimeTypes('fCylinder(context, id + "post", { "bottomCenter" : b, "topCenter" : t, "radius" : r });').code,
  'fCylinder(context, id + "post", { "bottomCenter" : b, "topCenter" : t, "radius" : r });');

// 7e) concatenate -> concatenateArrays
check("concatenate(a, b) -> concatenateArrays([a, b])",
  autoFixRuntimeTypes("var all = concatenate(left, right);").code,
  "var all = concatenateArrays([left, right]);");

// 8) one join of everything at the end of the feature body
const feature = lines(
  "export const thing = defineFeature(function(context is Context, id is Id, definition is map)",
  "    precondition",
  "    {",
  "        isLength(definition.size, { (inch) : [1, 2, 3] } as LengthBoundSpec);",
  "    }",
  "    {",
  "        kitBox(context, id + \"main\", skPlane, 0, 0, 0, 1, 1, 1);",
  "    });",
  "",
  "function helper(x)",
  "{",
  "    return x;",
  "}",
);
const merged = appendAutoMerge(feature);
check("merge inserted inside the feature body", merged.indexOf("autoMerge") > merged.indexOf("kitBox") && merged.indexOf("autoMerge") < merged.indexOf("    });"), true);
check("helper after the feature untouched", merged.endsWith(lines("function helper(x)", "{", "    return x;", "}")), true);
check("merge added once", appendAutoMerge(merged), merged);

console.log(failures === 0 ? "\nALL KIT FIX CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
