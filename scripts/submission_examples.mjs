// Prints the FeatureScript library (data/fs_examples) as JSON with validator results.
// When Onshape API keys are configured (.env), each feature is also executed in the
// live test Part Studio and `onshape` is true/false (null = not checked).
// Used by scripts/build_submission_pdf.py; run: node scripts/submission_examples.mjs
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url) });
// stdout carries the JSON, so route any library logging to stderr.
console.log = (...args) => console.error(...args);
const { validateFeatureScriptStrict } = await import('../ai.js');
const { isOnshapeConfigured, testCompileFeatureScript } = await import('../onshapeClient.js');

const dir = new URL('../data/fs_examples/', import.meta.url);
const { examples } = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
const paramRe = /annotation\s*\{\s*"Name"\s*:\s*"([^"]+)"[^}]*\}\s*\n\s*(?:is(\w+)\(definition\.\w+|definition\.\w+\s+is\s+(\w+))/g;
const checkOnshape = isOnshapeConfigured();

const out = [];
for (const e of examples) {
  const code = readFileSync(new URL(e.file, dir), 'utf8');
  const strict = validateFeatureScriptStrict(code);
  const live = checkOnshape ? await testCompileFeatureScript(code) : null;
  out.push({
    ...e,
    code,
    ok: strict.ok,
    blocking: strict.blockingIssueCount,
    onshape: live ? live.ok : null,
    onshapeErrors: live?.errors?.map((err) => err.message) || [],
    typeName: (code.match(/"Feature Type Name"\s*:\s*"([^"]+)"/) || [])[1] || e.title,
    exportName: (code.match(/export const (\w+)\s*=\s*defineFeature/) || [])[1] || '',
    params: [...code.matchAll(paramRe)].map((m) => ({ name: m[1], type: m[2] || m[3] })),
  });
}
process.stdout.write(JSON.stringify(out));
