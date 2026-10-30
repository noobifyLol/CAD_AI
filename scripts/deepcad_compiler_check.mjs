// Regression harness for deepcadCompiler.js (DeepCAD / Text2CAD sequences → FeatureScript).
// Run with: npm run test:deepcad   (offline; no API keys needed)
import { readFileSync } from 'node:fs';
import { dumpFs } from './lib/dumpFs.mjs';
import {
  compileCadSequenceToFeatureScript,
  deepcadJsonToCadSequence,
  eulerZyxDegreesToMatrix,
  text2cadMinimalJsonToCadSequence,
  validateCadSequence,
} from '../deepcadCompiler.js';

const { validateFeatureScriptStrict } = await import('../ai.js');

let failures = 0;
const fixture = name => JSON.parse(readFileSync(new URL(`../data/deepcad_fixtures/${name}`, import.meta.url), 'utf8'));
const pass = label => console.log(`PASS ${label}`);
const fail = (label, detail) => { failures += 1; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function expectCompiles(label, input, checks = []) {
  const result = compileCadSequenceToFeatureScript(input, { featureName: 'testPart' });
  if (!result.ok) return fail(label, result.errors.join('; '));
  dumpFs(`deepcad_${label}`, result.code);
  const strict = validateFeatureScriptStrict(result.code);
  if (!strict.ok) {
    return fail(label, [...strict.blockingIssues, ...strict.fatalIssues].map(i => i.message).slice(0, 4).join('; '));
  }
  for (const [what, ok] of checks.map(check => check(result))) {
    if (!ok) return fail(label, what);
  }
  pass(`${label} (${result.stats.steps} steps, ${result.stats.curves} curves, ${result.code.length} chars)`);
  return result;
}

const has = (fragment, what = `contains ${fragment}`) => result => [what, result.code.includes(fragment)];

// 1) DeepCAD JSON: plate + hole, joined stadium boss (arcs), symmetric cut on a side plane.
const deepcad = fixture('deepcad_plate_boss_pin.json');
expectCompiles('deepcad-json plate/boss/pin', deepcad, [
  has('BooleanOperationType.UNION'),
  has('BooleanOperationType.SUBTRACTION'),
  has('skArc('),
  has('opDeleteBodies('),
  result => ['default size is the real size in inches (0.1 m plate → ~3.94 in; the oversized cut tool is ignored)', near(result.stats.defaultSizeInches, 0.1 / 0.0254, 1e-3)],
]);

// Arc mid-points follow CadSeqProc: center + R * rot(midAngle) · referenceVector.
const seq = deepcadJsonToCadSequence(deepcad);
const firstArc = seq.steps[1].faces[0].loops[0][1];
if (near(firstArc.mid[0], 0.02) && near(firstArc.mid[1], 0)) pass('deepcad arc mid-point (right end of stadium at u=0.02)');
else fail('deepcad arc mid-point', JSON.stringify(firstArc.mid));
// Symmetric extent 0.2 → 0.1 each way; outer loop sorted first.
const cutStep = seq.steps[2];
if (near(cutStep.extrude.towardsNormal, 0.1) && near(cutStep.extrude.oppositeNormal, 0.1)) pass('deepcad symmetric extent split');
else fail('deepcad symmetric extent split', JSON.stringify(cutStep.extrude));
if (seq.steps[0].faces[0].loops[0].length === 4) pass('deepcad outer loop ordered first');
else fail('deepcad outer loop ordered first');

// 2) Text2CAD minimal JSON ring.
const ring = fixture('text2cad_ring_minimal.json');
expectCompiles('text2cad minimal-json ring', ring, [has('skCircle(')]);
// scipy R.from_euler("zyx", [0, 0, -90], degrees=True).as_matrix() rows (checked with scipy 1.x).
const m = eulerZyxDegreesToMatrix([0, 0, -90]);
const expected = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
if (m.every((row, i) => row.every((v, j) => near(v, expected[i][j])))) pass('euler zyx matches scipy convention');
else fail('euler zyx matches scipy convention', JSON.stringify(m));
const m2 = eulerZyxDegreesToMatrix([-90, 0, -90]);
const expected2 = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
if (m2.every((row, i) => row.every((v, j) => near(v, expected2[i][j])))) pass('euler zyx [-90,0,-90]');
else fail('euler zyx [-90,0,-90]', JSON.stringify(m2));
// An arbitrary rotation, cross-checked against scipy.
const m3 = eulerZyxDegreesToMatrix([30, -20, 70]);
const expected3 = [[0.813798, -0.469846, -0.34202], [-0.107325, 0.456895, -0.883022], [0.571152, 0.755309, 0.321394]];
if (m3.every((row, i) => row.every((v, j) => near(v, expected3[i][j])))) pass('euler zyx [30,-20,70] matches scipy');
else fail('euler zyx [30,-20,70] matches scipy', JSON.stringify(m3));
const ringSeq = text2cadMinimalJsonToCadSequence(ring);
if (ringSeq.steps[0].faces[0].loops.length === 2) pass('minimal-json loops preserved');
else fail('minimal-json loops preserved');

// 3) cad-sequence/v1 with arcs, a two-sided extrude, join and intersect.
expectCompiles('v1 d-link (two-sided + join + intersect)', fixture('v1_d_link.json'), [
  has('BooleanOperationType.INTERSECTION'),
  // The 4 mm + 4 mm two-sided extrude starts 4 mm below the base plane; the material
  // bodies span 22 mm (y -6..16), so the start is -4 / 22 = -0.181818.
  has('skPlane.normal * (-0.181818))', 'two-sided extrude plane shifted back by the opposite depth'),
]);

// 3b) Arbitrarily rotated sketch planes (Onshape needs x ⟂ normal within 1e-11,
// so the compiler re-orthogonalizes at runtime instead of trusting rounded literals).
expectCompiles('v1 rotated planes', fixture('v1_rotated_planes.json'), [
  has('normalize(x1 - n1 * dot(x1, n1))', 'runtime re-orthogonalization of the plane x axis'),
]);

// 4) Size override + placement plane.
const sized = compileCadSequenceToFeatureScript(ring, { sizeInches: 5, featureLabel: 'Ring' });
if (sized.ok && sized.code.includes('[0.05, 5, 200]') && sized.code.includes('"Feature Type Name" : "Ring"')) pass('size override + label');
else fail('size override + label');

// 5) Negative cases must be rejected with a precise message, never compiled.
function expectRejected(label, input, fragment) {
  const result = compileCadSequenceToFeatureScript(input);
  if (!result.ok && result.errors.join(' ').toLowerCase().includes(fragment)) return pass(`rejects ${label}`);
  fail(`rejects ${label}`, result.ok ? 'compiled anyway' : result.errors.join('; '));
}
const base = () => JSON.parse(JSON.stringify(fixture('v1_d_link.json')));
const open = base(); open.steps[0].faces[0].loops[0].pop();
expectRejected('open loop', open, 'does not connect');
const zero = base(); zero.steps[0].extrude = { towardsNormal: 0, oppositeNormal: 0, operation: 'new' };
expectRejected('zero depth', zero, 'zero total depth');
const firstCut = base(); firstCut.steps[0].extrude.operation = 'cut';
expectRejected('cut as first step', firstCut, 'first step cannot');
const parallel = base(); parallel.steps[0].plane.xAxis = [0, 0, 1];
expectRejected('x axis parallel to normal', parallel, 'parallel');
expectRejected('unknown format', { hello: 1 }, 'unrecognised');
if (validateCadSequence({ steps: [] }).length) pass('rejects empty sequence'); else fail('rejects empty sequence');

if (failures) {
  console.log(`\n${failures} DEEPCAD COMPILER CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL DEEPCAD COMPILER CHECKS PASSED');
