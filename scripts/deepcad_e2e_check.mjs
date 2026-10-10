// End-to-end check of the DeepCAD path exactly as the website calls it:
//   browser fetch → server.js /generate-deepcad → model service (HTTP) → compiler → /verify
// A stand-in model service replays a real Text2CAD-decoded sequence
// (data/deepcad_fixtures/text2cad_decoded_plate.json, produced by hf_space's serializer
// from Text2CAD's own token format) and answers 503 first, like a waking Space.
// Run with: npm run test:deepcad-e2e   (offline; no API keys needed)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = name => JSON.parse(readFileSync(new URL(`../data/deepcad_fixtures/${name}`, import.meta.url), 'utf8'));
const decoded = fixture('text2cad_decoded_plate.json');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

// ── stand-in model service ──
let modelCalls = 0;
let lastAuth = null;
const model = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    modelCalls += 1;
    lastAuth = req.headers.authorization || null;
    const prompt = JSON.parse(body || '{}').prompt || '';
    res.setHeader('Content-Type', 'application/json');
    if (modelCalls === 1) { res.statusCode = 503; return res.end(JSON.stringify({ detail: 'Model is still loading' })); }
    if (/garbage/.test(prompt)) { res.statusCode = 422; return res.end(JSON.stringify({ detail: 'Model produced no usable sketch/extrude steps.' })); }
    res.end(JSON.stringify({ sequence: decoded, elapsedSec: 1.2, model: 'Text2CAD v1.0 (stand-in)' }));
  });
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const modelUrl = `http://127.0.0.1:${model.address().port}`;

// ── the real app server ──
const port = 10500 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, ['server.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    DEEPCAD_MODEL_URL: modelUrl,
    DEEPCAD_MODEL_TOKEN: 'test-token',
    DEEPCAD_MODEL_WAKE_MS: '30000',
    ONSHAPE_COMPILE_CHECK_ENABLED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i += 1) {
  try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* booting */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
const post = async (path, body) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

try {
  const health = await (await fetch(`${base}/health`)).json();
  check('/health reports the DeepCAD model as configured', health.deepcad?.configured === true, JSON.stringify(health.deepcad));

  // The website's page loads the UI from the same server.
  const page = await (await fetch(`${base}/`)).text();
  check('website serves the DeepCAD controls', page.includes('id="gen-engine"') && page.includes('verifyGeneratedCode()'));

  // 1) prompt → model (503 first, then a sequence) → FeatureScript
  const gen = await post('/generate-deepcad', { prompt: 'A 60 mm plate with a raised slot boss and a cross pin hole' });
  check('/generate-deepcad succeeds after the model wakes (503 → retry)', gen.status === 200 && modelCalls >= 2, `${gen.status} ${JSON.stringify(gen.data).slice(0, 300)}`);
  check('model request carries the bearer token', lastAuth === 'Bearer test-token', String(lastAuth));
  check('returns FeatureScript 2931', /^FeatureScript 2931;/.test(gen.data.code || ''));
  check('size taken from the prompt (60 mm → 2.362205 in)', (gen.data.code || '').includes('[0.05, 2.362205, 200]'));
  check('mode is deepcad_text2cad_model', gen.data.generationMode === 'deepcad_text2cad_model', gen.data.generationMode);
  check('verification attached and static validator passes', gen.data.verification?.static?.ok === true, JSON.stringify(gen.data.verification));
  check('Onshape check honestly reported as not run', gen.data.verification?.verdict === 'static_ok' && Boolean(gen.data.verification?.onshape?.skippedReason));

  // 2) model answers but output is unusable → clean 422 for the page to show
  const bad = await post('/generate-deepcad', { prompt: 'garbage' });
  check('unusable model output becomes a 422 with a message', bad.status === 422 && /no usable/.test(bad.data.error || ''), `${bad.status} ${bad.data.error}`);

  // 3) JSON import box: DeepCAD JSON and Text2CAD minimal JSON
  const imported = await post('/generate-deepcad', { sequence: fixture('deepcad_plate_boss_pin.json'), featureLabel: 'Imported Plate' });
  check('DeepCAD JSON import compiles', imported.status === 200 && imported.data.generationMode === 'deepcad_sequence_import', `${imported.status} ${imported.data.error || ''}`);
  const minimal = await post('/generate-deepcad', { sequence: fixture('text2cad_ring_minimal.json') });
  check('Text2CAD minimal JSON import compiles', minimal.status === 200, `${minimal.status} ${minimal.data.error || ''}`);
  const broken = await post('/generate-deepcad', { sequence: { steps: [] } });
  check('invalid sequence → 422 with reason', broken.status === 422 && /no steps/i.test(broken.data.error || ''), `${broken.status} ${broken.data.error}`);

  // 4) "Verify in Onshape" button → /verify
  const verified = await post('/verify', { code: gen.data.code });
  check('/verify on generated code', verified.status === 200 && verified.data.static?.ok === true, JSON.stringify(verified.data).slice(0, 300));
  const badCode = await post('/verify', { code: 'FeatureScript 2931;\nexport const x = defineFeature(function(context is Context, id is Id, definition is map)\n{\n opPatternCircular(context, id, {});\n' });
  check('/verify flags broken FeatureScript', badCode.status === 200 && badCode.data.verdict === 'static_errors', JSON.stringify(badCode.data).slice(0, 300));
} finally {
  server.kill();
  model.close();
}

if (failures) {
  console.log(`\n${failures} DEEPCAD E2E CHECK(S) FAILED\n--- server log ---\n${serverLog.slice(-3000)}`);
  process.exit(1);
}
console.log('\nALL DEEPCAD E2E CHECKS PASSED');
