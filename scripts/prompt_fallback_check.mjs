// Regression harness for the no-AI fallback: the library example chosen for a prompt
// must be the right one, and the sizes/counts the prompt gives must land in the
// example's dialog defaults (promptDimensions.js). Offline; no API keys needed.
// Run with: npm run test:fallback
import { parsePromptMeasurements, promptDimsFallback, promptFeatureNames } from '../promptDimensions.js';

const { buildGuaranteedFeatureScript, validateFeatureScriptStrict } = await import('../ai.js');

let failures = 0;
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= Math.max(1e-3, Math.abs(b) * 2e-3);
const defaults = code => Object.fromEntries(
  [...code.matchAll(/(?:isLength|isInteger)\(definition\.(\w+),\s*\{\s*\((?:inch|unitless)\)\s*:\s*\[[^,]+,\s*([^,]+),/g)].map(m => [m[1], Number(m[2])]),
);

function expectExample(prompt, title, expected = {}) {
  const dims = { featureName: 'part', featureLabel: 'Part', shape: 'CUSTOM', confidence: 'LOW', ...promptDimsFallback(prompt) };
  const result = buildGuaranteedFeatureScript(prompt, dims, {}, null, {});
  const values = defaults(result.code || '');
  const problems = [];
  if (result.featureLabel !== title) problems.push(`example "${result.featureLabel}" (want "${title}")`);
  if (!validateFeatureScriptStrict(result.code || '').ok) problems.push('does not validate');
  for (const [name, want] of Object.entries(expected)) {
    if (typeof want === 'function' ? !want(values[name], values) : !near(values[name], want)) {
      problems.push(`${name}=${values[name]} (want ${typeof want === 'function' ? 'check' : want})`);
    }
  }
  if (problems.length) { failures += 1; console.log(`FAIL ${prompt} — ${problems.join('; ')}`); }
  else console.log(`PASS ${prompt} → ${title}`);
}

expectExample('Create a hex nut 1 inch across flats', 'Hex Nut', { acrossFlats: 1 });
expectExample('a wheel with 8 spokes, 6 inch diameter', 'Wheel With Spokes', { spokeCount: 8, rimRadius: 3, hubRadius: 0.6 });
expectExample('a 4 x 2 inch plate with 4 mounting holes, 0.25 thick', 'Plate With Mounting Holes', { width: 4, height: 2, thickness: 0.25 });
expectExample('M10 hex bolt 40 mm long', 'Hex Bolt', { shaftRadius: 0.19685, shaftLength: 1.5748 });
expectExample('a cylinder 2 inch diameter 3 inch tall', 'Cylinder With Bore', { outerRadius: 1, height: 3 });
expectExample('a box 50mm x 30mm x 20mm', 'Open Top Box', { width: 1.9685, depth: 1.1811, height: 0.7874 });
expectExample('an L bracket 3 inch tall', 'L Bracket With Fillet', { legHeight: 3 });
expectExample('a washer with 1 inch outer diameter and 0.5 inch hole', 'Cylinder With Bore', { outerRadius: 0.5, boreRadius: 0.25 });
expectExample('a picture frame 8x10 inch', 'Picture Frame', { outerWidth: 8, outerHeight: 10 });
expectExample('a heatsink with 20 fins', 'Heatsink With Linear Patterned Fins', {
  finCount: 20,
  finSpacing: (spacing, v) => spacing * 19 + v.finThickness <= v.baseWidth + 1e-6,
});
expectExample('a flange with six bolt holes, 100 mm diameter', 'Bolt Circle Flange', { boltCount: 6, flangeRadius: 1.9685 });
expectExample('a sphere 2 inch diameter', 'Sphere', { radius: 1 });
expectExample('a torus ring', 'Torus');
expectExample('a knob with knurling', 'Knurled Knob');
expectExample('a pen', 'Pen With Tip And Clip', { barrelRadius: 0.22, barrelLength: 4.5 });
expectExample('a cup 0.5 inch wide with a 3 inch bore', 'Cup With Handle', {
  // a hole larger than the part must be shrunk to fit, never emitted as-is
  cupRadius: (r) => r > 0,
});

// Dimension fallback used when the LLM dimension step is unavailable.
const gear = promptDimsFallback('a 2 inch diameter gear with 30 teeth, 0.5 inch thick');
if (gear.numTeeth === 30 && near(gear.radiusInches, 1) && near(gear.depthInches, 0.5)) console.log('PASS gear dims from prompt');
else { failures += 1; console.log(`FAIL gear dims from prompt — ${JSON.stringify(gear)}`); }
const cube = promptDimsFallback('a 10mm cube');
if (near(cube.widthInches, 0.3937) && near(cube.heightInches, 0.3937) && near(cube.depthInches, 0.3937)) console.log('PASS cube dims from prompt');
else { failures += 1; console.log(`FAIL cube dims from prompt — ${JSON.stringify(cube)}`); }
const none = parsePromptMeasurements('a pen');
if (!none.lengths.length && !none.counts.length && !none.triple) console.log('PASS no numbers → nothing applied');
else { failures += 1; console.log('FAIL no numbers → nothing applied'); }
const label = promptFeatureNames('create a 4 x 2 inch spur gear with 24 teeth');
if (label.featureLabel === 'Spur Gear' && label.featureName === 'spurGear') console.log('PASS feature name from prompt');
else { failures += 1; console.log(`FAIL feature name from prompt — ${JSON.stringify(label)}`); }

if (failures) { console.log(`\n${failures} FALLBACK CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL FALLBACK CHECKS PASSED');
