// Regression harness for the FeatureScript validator + sanitizer.
// Run with: npm run test:validator
import { dumpFs } from './lib/dumpFs.mjs';
// - Own templates and guaranteed builders must validate clean (no false positives,
//   and the sanitizer must not corrupt valid code).
// - Known-bad FeatureScript patterns must be flagged.
import dotenv from 'dotenv';
dotenv.config();
const { validateFeatureScriptStrict, buildGuaranteedFeatureScript, STRICT_FEATURESCRIPT_TEMPLATE } = await import('../ai.js');

let failures = 0;

function expectClean(label, code) {
  const strict = validateFeatureScriptStrict(code);
  if (strict.ok) { console.log(`PASS (clean)   ${label}`); return; }
  failures += 1;
  console.log(`FAIL (should be clean) ${label} — blocking=${strict.blockingIssueCount} fatal=${strict.fatalIssueCount}`);
  for (const i of strict.blockingIssues.slice(0, 6)) console.log(`    BLOCKING: ${i.message} | ${(i.text || '').slice(0, 80)}`);
  for (const i of strict.fatalIssues.slice(0, 6)) console.log(`    FATAL: ${i.message}`);
}

function expectFlagged(label, code, mustMention) {
  const strict = validateFeatureScriptStrict(code);
  const all = [...strict.blockingIssues, ...strict.fatalIssues].map(i => i.message).join(' :: ');
  const hit = !strict.ok && (!mustMention || mustMention.some(frag => all.toLowerCase().includes(frag.toLowerCase())));
  if (hit) { console.log(`PASS (flagged) ${label}`); return; }
  failures += 1;
  console.log(`FAIL (should be flagged) ${label} — ok=${strict.ok}`);
  console.log(`    issues seen: ${all.slice(0, 400)}`);
}

// 1) Own template must stay clean
dumpFs('strict_template', STRICT_FEATURESCRIPT_TEMPLATE);
expectClean('STRICT_FEATURESCRIPT_TEMPLATE', STRICT_FEATURESCRIPT_TEMPLATE);

// 2) Guaranteed builders across shapes must stay clean
const shapes = [
  ['box', { shape: 'BOX', widthInches: 2, heightInches: 2, depthInches: 1 }],
  ['cylinder', { shape: 'CYLINDER', radiusInches: 1, heightInches: 2 }],
  ['gear', { shape: 'GEAR_SPUR', numTeeth: 20, pitchRadiusInches: 1.5, faceWidthInches: 0.5 }],
  ['l-bracket', { shape: 'L_BRACKET', widthInches: 2, heightInches: 3, depthInches: 0.25 }],
  ['flange', { shape: 'FLANGE', radiusInches: 2, heightInches: 0.5 }],
  ['cup', { shape: 'CYLINDER', radiusInches: 1.5, heightInches: 3 }],
];
for (const [name, dims] of shapes) {
  const result = buildGuaranteedFeatureScript(`Create a ${name}`, {
    featureName: `${name.replace(/[^a-z]/g, '')}Feature`, featureLabel: `${name} feature`, confidence: 'LOW', ...dims,
  }, {}, null, {});
  if (!result?.code) { failures += 1; console.log(`FAIL guaranteed builder returned no code for ${name}`); continue; }
  dumpFs(`guaranteed_${name}`, result.code);
  expectClean(`guaranteed:${name}`, result.code);
}

// 3) Known-bad code (BoundSpec cast on a sketch call, unit-stripped radius,
//    undeclared definition param, hole extruded but never subtracted) must be flagged.
const badBracketCode = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Mounting Bracket" }
export const mountingBracket = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Width" }
        isLength(definition.width, { (inch) : [0.1, 10.0, 24.0] } as LengthBoundSpec);
        annotation { "Name" : "Hole Radius" }
        isLength(definition.holeRadius, { (inch) : [0.01, 1.0, 2.0] } as LengthBoundSpec);
    }
    {
        var skPlane = plane(WORLD_ORIGIN, Z_DIRECTION);
        var bodySk = newSketchOnPlane(context, id + "bodySk", { "sketchPlane" : skPlane } as LengthBoundSpec);
        skRectangle(bodySk, "body", {
            "firstCorner" : vector(0, 0) * inch,
            "secondCorner" : vector(definition.width / inch, definition.width / inch) * inch
        });
        skSolve(bodySk);
        opExtrude(context, id + "body", {
            "entities"  : qSketchRegion(id + "bodySk"),
            "direction" : Z_DIRECTION,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
        var holeSk = newSketchOnPlane(context, id + "holeSk", { "sketchPlane" : skPlane });
        skCircle(holeSk, "hole", { "center" : vector(0, 0) * inch, "radius" : definition.holeRadius / inch });
        skSolve(holeSk);
        opExtrude(context, id + "holeCut", {
            "entities"  : qSketchRegion(id + "holeSk"),
            "direction" : Z_DIRECTION,
            "endBound"  : BoundingType.BLIND,
            "endDepth"  : definition.thickness
        });
    });`;
expectFlagged('bad bracket (4 error classes)', badBracketCode, ['BoundSpec cast', 'strips units', 'never declared', 'SUBTRACTION']);

// 4) Unbalanced braces must be flagged
expectFlagged('unbalanced braces', STRICT_FEATURESCRIPT_TEMPLATE.replace(/\}\);\s*$/, ''), ['Unbalanced', 'truncated']);

// 5) Unitless numeric sketch point must be flagged
expectFlagged('unitless center vector', STRICT_FEATURESCRIPT_TEMPLATE.replace(
  '"firstCorner" : vector((-halfWidth) / inch, (-halfHeight) / inch) * inch,',
  '"firstCorner" : vector(-1, -1),'
), ['need units']);

// 6) Hallucinated op-level "operationType": ExtrudeOperationType.CUT (seen live on the
//    web app: Onshape "Variable ExtrudeOperationType not found"). As the last key or a
//    middle key, the sanitizer must drop it and leave valid code; used anywhere else it
//    must be flagged.
const firstEndDepth = /("endDepth"\s*:\s*definition\.\w+)/;
for (const [label, insert] of [
  ['fake ExtrudeOperationType as last key', '$1,\n            "operationType" : ExtrudeOperationType.CUT'],
  ['fake ExtrudeOperationType as middle key', '"operationType" : ExtrudeOperationType.CUT,\n            $1'],
]) {
  const bad = STRICT_FEATURESCRIPT_TEMPLATE.replace(firstEndDepth, insert);
  const strict = validateFeatureScriptStrict(bad);
  if (bad !== STRICT_FEATURESCRIPT_TEMPLATE && strict.ok && !/ExtrudeOperationType/.test(strict.code)) {
    console.log(`PASS (repaired) ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL (should be repaired) ${label} — ok=${strict.ok} stillPresent=${/ExtrudeOperationType/.test(strict.code)}`);
  }
}
expectFlagged('fake RevolveOperationType outside a map', STRICT_FEATURESCRIPT_TEMPLATE.replace(
  firstEndDepth, '$1\n        });\n        var mode = RevolveOperationType.CUT;\n        ({ "x" : 1'
), ['enum does not exist']);

// 7) A body queried by the id of the shell that modified it (empty in Onshape) must be
//    rewritten to the extrude that created it; the shell's own entities stay untouched.
{
  const shellCase = STRICT_FEATURESCRIPT_TEMPLATE.replace(firstEndDepth, '$1\n        });\n'
    + '        opShell(context, id + "shell", { "entities" : qCreatedBy(id + "extrudeBody", EntityType.BODY), "thickness" : 0.05 * inch });\n'
    + '        opFillet(context, id + "round", { "entities" : qOwnedByBody(qCreatedBy(id + "shell", EntityType.BODY), EntityType.EDGE), "radius" : 0.01 * inch });\n'
    + '        ({ "x" : 1');
  const strict = validateFeatureScriptStrict(shellCase);
  const fixed = strict.code.includes('qOwnedByBody(qCreatedBy(id + "extrudeBody", EntityType.BODY)')
    && !strict.code.includes('qCreatedBy(id + "shell", EntityType.BODY)')
    && strict.code.includes('"entities" : qCreatedBy(id + "extrudeBody", EntityType.BODY), "thickness"');
  if (shellCase !== STRICT_FEATURESCRIPT_TEMPLATE && fixed) console.log('PASS (repaired) body queried by shell id -> creating extrude');
  else { failures += 1; console.log('FAIL (should be repaired) body queried by shell id'); }
}

// 8) Open revolve profile (live web failure: spray bottle with no bottom line ->
//    Onshape "Cannot resolve entities"). The sanitizer must add the missing segment
//    with the model's own parametric endpoints; a typo'd sketch id must be flagged.
{
  const { readFileSync } = await import('node:fs');
  const vase = readFileSync(new URL('../data/fs_examples/revolved_vase.fs', import.meta.url), 'utf8');
  const open = vase.replace(/[ \t]*skLineSegment\(profileSketch, "baseClose", \{[\s\S]*?\}\);\r?\n/, '');
  const strict = validateFeatureScriptStrict(open);
  if (open !== vase && strict.ok && /"autoClose"/.test(strict.code)) console.log('PASS (repaired) open revolve profile closed automatically');
  else { failures += 1; console.log(`FAIL (should be repaired) open revolve profile — ok=${strict.ok}`); }
  expectFlagged('query names a sketch id that does not exist', vase.replace('qSketchRegion(id + "profileSketch")', 'qSketchRegion(id + "profileSketchX")'), ['no operation or sketch']);
}

// 9) False positives that rejected good candidates (2026-10-22 batch): dashes in comments
//    were reported as the "--" operator, fCylinder with a map was reported as positional
//    args. i++ / ++i must still be repaired, and comments/strings must stay untouched.
{
  const { readFileSync } = await import('node:fs');
  const vase = readFileSync(new URL('../data/fs_examples/revolved_vase.fs', import.meta.url), 'utf8');
  const marker = 'skSolve(profileSketch);';
  const extras = '\n        // Neck ----------------\n        var label = "Wall -- inner";\n        var n = 0;\n        n++;\n        ++n;\n'
    + '        fCylinder(context, id + "peg", { "bottomCenter" : vector(0, 0, 0) * inch, "topCenter" : vector(0, 0, 1) * inch, "radius" : 0.1 * inch });\n';
  const code = vase.replace(marker, marker + extras);
  expectClean('dashes in comments and fCylinder with a map are not errors', code);
  const strict = validateFeatureScriptStrict(code);
  const ok = code !== vase && strict.code.includes('// Neck ----------------') && strict.code.includes('"Wall -- inner"')
    && !/\+\+/.test(strict.code.replace(/\/\/.*$/gm, ''));
  if (ok) console.log('PASS (repaired) i++ / ++i fixed, comments and strings untouched');
  else { failures += 1; console.log('FAIL i++ / ++i repair or comment/string damage'); }
}

// 10) opBoolean UNION ignores "targets" in Onshape: they must be merged into "tools".
{
  const { readFileSync } = await import('node:fs');
  const vase = readFileSync(new URL('../data/fs_examples/revolved_vase.fs', import.meta.url), 'utf8');
  const marker = 'skSolve(profileSketch);';
  const extras = '\n        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * inch, "corner2" : vector(1, 1, 1) * inch });\n'
    + '        fCuboid(context, id + "b", { "corner1" : vector(0.5, 0, 0) * inch, "corner2" : vector(2, 1, 1) * inch });\n'
    + '        opBoolean(context, id + "join", {\n            "tools" : qCreatedBy(id + "b", EntityType.BODY),\n'
    + '            "operationType" : BooleanOperationType.UNION,\n            "targets" : qCreatedBy(id + "a", EntityType.BODY)\n        });\n';
  const strict = validateFeatureScriptStrict(vase.replace(marker, marker + extras));
  const call = strict.code.slice(strict.code.indexOf('opBoolean(context, id + "join"'));
  const fixed = /"tools"\s*:\s*qUnion\(\[qCreatedBy\(id \+ "b", EntityType\.BODY\), qCreatedBy\(id \+ "a", EntityType\.BODY\)\]\)/.test(call)
    && !/"targets"/.test(call.slice(0, call.indexOf(');')));
  if (fixed) console.log('PASS (repaired) UNION targets merged into tools');
  else { failures += 1; console.log('FAIL (should be repaired) UNION targets'); }
}

// 11) Revolve about the sketch normal (user's "Simple Cone": Onshape "Revolved face is
//     perpendicular to axis"): flagged by the geometry check and rewritten to the in-plane y axis.
{
  const cone = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Simple Cone" }
export const simpleCone = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Plane", "Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1 }
        definition.location is Query;
        annotation { "Name" : "Base Radius" }
        isLength(definition.baseRadius, { (inch) : [0.1, 1, 10] } as LengthBoundSpec);
        annotation { "Name" : "Height" }
        isLength(definition.height, { (inch) : [0.1, 2, 20] } as LengthBoundSpec);
    }
    {
        var skPlane = isQueryEmpty(context, definition.location) ? plane(vector(0, 0, 0) * inch, vector(0, 0, 1), vector(1, 0, 0)) : evPlane(context, { "face" : definition.location });
        var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : skPlane });
        skLineSegment(sk, "base", { "start" : vector(0, 0) * inch, "end" : vector(definition.baseRadius / inch, 0) * inch });
        skLineSegment(sk, "slant", { "start" : vector(definition.baseRadius / inch, 0) * inch, "end" : vector(0, definition.height / inch) * inch });
        skLineSegment(sk, "axisLine", { "start" : vector(0, definition.height / inch) * inch, "end" : vector(0, 0) * inch });
        skSolve(sk);
        opRevolve(context, id + "revolve", {
            "entities" : qSketchRegion(id + "sk"),
            "axis" : line(skPlane.origin, skPlane.normal),
            "angleForward" : 2 * PI * radian
        });
    });
`;
  const { checkFeatureScriptGeometry } = await import('../featureScriptGeometry.js');
  const flagged = checkFeatureScriptGeometry(cone).some(issue => /perpendicular to axis/.test(issue.message));
  const strict = validateFeatureScriptStrict(cone);
  const fixed = strict.ok && strict.code.includes('line(skPlane.origin, cross(skPlane.normal, skPlane.x))');
  if (flagged && fixed) console.log('PASS (repaired) revolve axis along the sketch normal');
  else { failures += 1; console.log(`FAIL revolve axis along the sketch normal — flagged=${flagged} fixed=${fixed}`); }
}

console.log(failures === 0 ? '\nALL VALIDATOR CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
