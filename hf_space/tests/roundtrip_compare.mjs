// Checks that a sequence decoded by the Space (hf_space/tests/test_space.py --out)
// is the same shape as the DeepCAD fixture it was encoded from, up to the global
// normalization and 8-bit quantization Text2CAD applies.
//   node hf_space/tests/roundtrip_compare.mjs /tmp/decoded.json
import { readFileSync } from 'node:fs';
import { compileCadSequenceToFeatureScript, deepcadJsonToCadSequence } from '../../deepcadCompiler.js';

const decoded = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const original = deepcadJsonToCadSequence(JSON.parse(readFileSync(new URL('../../data/deepcad_fixtures/deepcad_plate_boss_pin.json', import.meta.url), 'utf8')));

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const n = Math.hypot(...v); return v.map(x => x / n); };

// 3D key points per step: curve end/mid points, circle centers, both extrude caps.
function keyPoints(sequence) {
  return sequence.steps.map((step) => {
    const normal = unit(step.plane.normal);
    const xAxis = unit(step.plane.xAxis);
    const yAxis = cross(normal, xAxis);
    const to3d = ([u, v], w) => step.plane.origin.map((o, i) => o + u * xAxis[i] + v * yAxis[i] + w * normal[i]);
    const points = [];
    for (const face of step.faces) for (const loop of face.loops) for (const c of loop) {
      const uvs = c.type === 'circle' ? [c.center, [c.center[0] + c.radius, c.center[1]], [c.center[0], c.center[1] + c.radius]]
        : c.type === 'arc' ? [c.start, c.mid, c.end] : [c.start, c.end];
      for (const uv of uvs) points.push(to3d(uv, step.extrude.towardsNormal), to3d(uv, -step.extrude.oppositeNormal));
    }
    return { op: step.extrude.operation, points };
  });
}

function normalizeTo(stepsPoints, reference) {
  const all = reference.flatMap(s => s.points);
  const min = [0, 1, 2].map(i => Math.min(...all.map(p => p[i])));
  const size = Math.max(...[0, 1, 2].map(i => Math.max(...all.map(p => p[i])) - min[i]));
  return stepsPoints.map(s => ({ ...s, points: s.points.map(p => p.map((x, i) => (x - min[i]) / size)) }));
}

const a = keyPoints(original);
const b = keyPoints(decoded);
// Normalize each by its own material bodies (steps 1-2), then compare point sets.
const na = normalizeTo(a, a.slice(0, 2));
const nb = normalizeTo(b, b.slice(0, 2));
let failures = 0;
const TOL = 0.03; // 8-bit quantization of a normalized model, plus the sketch-size token
na.forEach((stepA, i) => {
  const stepB = nb[i];
  if (!stepB || stepB.op !== stepA.op) { failures += 1; console.log(`FAIL step ${i + 1} operation`); return; }
  const worst = Math.max(...stepA.points.map(p => Math.min(...stepB.points.map(q => Math.hypot(...p.map((x, k) => x - q[k]))))));
  const ok = worst <= TOL;
  failures += ok ? 0 : 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} step ${i + 1} (${stepA.op}) geometry matches within ${worst.toFixed(4)} (tol ${TOL})`);
});
const compiled = compileCadSequenceToFeatureScript(decoded);
failures += compiled.ok ? 0 : 1;
console.log(`${compiled.ok ? 'PASS' : 'FAIL'} decoded sequence compiles to FeatureScript`);
console.log(failures ? `\n${failures} ROUND-TRIP CHECK(S) FAILED` : '\nROUND TRIP MATCHES');
process.exit(failures ? 1 : 0);
