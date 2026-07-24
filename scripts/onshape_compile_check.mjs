// Regression harness for the real Onshape compile check (onshapeClient.js).
// Run with: npm run test:onshape
// Unlike test:validator (regex-only, no network), this hits the live Onshape API
// using ONSHAPE_ACCESS_KEY/ONSHAPE_SECRET_KEY against the ONSHAPE_TEST_* document/
// workspace/part-studio configured in .env. Skips (not fails) if unconfigured.
import dotenv from 'dotenv';
dotenv.config();
const { isOnshapeConfigured, testCompileFeatureScript } = await import('../onshapeClient.js');
const { STRICT_FEATURESCRIPT_TEMPLATE, buildGuaranteedFeatureScript } = await import('../ai.js');

if (!isOnshapeConfigured()) {
  console.log('SKIP: Onshape compile check is not configured (missing keys/test document ids, or ONSHAPE_COMPILE_CHECK_ENABLED=false).');
  process.exit(0);
}

let failures = 0;

async function expectOk(label, code) {
  const result = await testCompileFeatureScript(code);
  if (result.ok === null) {
    console.log(`SKIP (harness could not test) ${label} — ${result.skippedReason}`);
    return;
  }
  if (result.ok) { console.log(`PASS (compiles) ${label}`); return; }
  failures += 1;
  console.log(`FAIL (should compile) ${label}`);
  for (const e of result.errors) console.log(`    ERROR: ${e.message}`);
}

async function expectError(label, code, mustMention) {
  const result = await testCompileFeatureScript(code);
  if (result.ok === null) {
    failures += 1;
    console.log(`FAIL (harness could not test — expected a real error) ${label} — ${result.skippedReason}`);
    return;
  }
  const all = result.errors.map((e) => e.message).join(' :: ');
  const hit = !result.ok && (!mustMention || mustMention.some((frag) => all.toLowerCase().includes(frag.toLowerCase())));
  if (hit) { console.log(`PASS (flagged) ${label}`); return; }
  failures += 1;
  console.log(`FAIL (should be flagged) ${label} — ok=${result.ok}`);
  console.log(`    errors seen: ${all.slice(0, 400)}`);
}

// 1) The system prompt's own strict template must actually compile in real Onshape.
await expectOk('STRICT_FEATURESCRIPT_TEMPLATE', STRICT_FEATURESCRIPT_TEMPLATE);

// 2) Guaranteed deterministic builders must actually compile, not just pass regex.
const shapes = [
  ['box', { shape: 'BOX', widthInches: 2, heightInches: 2, depthInches: 1 }],
  ['cylinder', { shape: 'CYLINDER', radiusInches: 1, heightInches: 2 }],
  ['l-bracket', { shape: 'L_BRACKET', widthInches: 2, heightInches: 3, depthInches: 0.25 }],
];
for (const [name, dims] of shapes) {
  const result = buildGuaranteedFeatureScript(`Create a ${name}`, {
    featureName: `${name.replace(/[^a-z]/g, '')}Feature`, featureLabel: `${name} feature`, confidence: 'LOW', ...dims,
  }, {}, null, {});
  if (!result?.code) { failures += 1; console.log(`FAIL guaranteed builder returned no code for ${name}`); continue; }
  await expectOk(`guaranteed:${name}`, result.code);
}

// 3) A call to a nonexistent function must be caught by the real compiler.
const undefinedFunctionCode = `FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Broken Test" }
export const brokenTest = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Length" }
        isLength(definition.myLen, LENGTH_BOUNDS);
    }
    {
        thisFunctionDoesNotExist(context, id, definition.myLen);
    });
`;
await expectError('undefined-function', undefinedFunctionCode, ['not found']);

console.log(`\n${failures === 0 ? 'ALL ONSHAPE COMPILE CHECKS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
