// Live check of the DeepCAD path with the REAL Text2CAD model:
//   prompt → Text2CAD service → deepcadCompiler → static validator + live Onshape (if keys are set)
// Needs the model service running (npm run deepcad:serve, or a deployed Space in DEEPCAD_MODEL_URL).
// Run with: npm run test:deepcad-live [-- "your own prompt" ...]
import dotenv from 'dotenv';
dotenv.config();
if (!process.env.DEEPCAD_MODEL_URL) process.env.DEEPCAD_MODEL_URL = 'http://127.0.0.1:7860';
const { generateDeepcadFeature } = await import('../deepcadService.js');

const modelUrl = process.env.DEEPCAD_MODEL_URL.replace(/\/+$/, '');
let health;
try {
  health = await (await fetch(`${modelUrl}/health`, { signal: AbortSignal.timeout(10000) })).json();
} catch (err) {
  console.log(`Model service at ${modelUrl} is not reachable (${err.message}). Start it with: npm run deepcad:serve`);
  process.exit(1);
}
if (!health.ok) {
  console.log(`Model service is not ready (status: ${health.status}).${health.error ? `\n${health.error}` : ''}`);
  process.exit(1);
}
console.log(`Model: ${health.model} on ${health.device}; weights ${JSON.stringify(health.weights)}\n`);

const prompts = process.argv.slice(2).length ? process.argv.slice(2) : [
  'A ring.',
  'A rectangular plate with four circular holes near the corners.',
  'A cylinder with a hole through the center.',
  'A 60 mm square plate, 5 mm thick, with a centered 20 mm hole.',
  'An L-shaped bracket.',
  'A hexagonal nut.',
  'A rectangular block with a smaller rectangular boss on top.',
  'A washer with an outer diameter of 30 mm and an inner diameter of 12 mm.',
];

let works = 0;
for (const [i, prompt] of prompts.entries()) {
  try {
    const r = await generateDeepcadFeature({ prompt });
    const ops = r.sequence.steps.map(s => s.extrude.operation).join('+');
    const kinds = [...new Set(r.sequence.steps.flatMap(s => s.faces.flatMap(f => f.loops.flat().map(c => c.type))))].join('/');
    const v = r.verification;
    if (v.verdict === 'works_in_onshape' || (v.verdict === 'static_ok' && !v.onshape.attempted)) works += 1;
    console.log(`[${i + 1}] ${v.verdict.padEnd(16)} ${r.stats.steps} step(s): ${ops} (${kinds}), model ${r.model?.elapsedSec}s | ${prompt}` +
      (v.onshape.errors.length ? `\n     Onshape: ${v.onshape.errors.map(e => e.message).join(' / ')}` : '') +
      (r.warnings.length ? `\n     note: ${r.warnings.join(' / ')}` : ''));
  } catch (err) {
    console.log(`[${i + 1}] ERROR ${err.status ?? ''} ${err.message} | ${prompt}`);
  }
}
console.log(`\n${works} / ${prompts.length} prompts produced working FeatureScript`);
process.exit(works ? 0 : 1);
