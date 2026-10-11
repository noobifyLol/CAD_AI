// Build the DeepCAD part library: real DeepCAD parts (Text2CAD minimal JSON) that compile
// to valid FeatureScript, each with its text description, for prompt -> part retrieval.
//
//   node scripts/deepcad_library/build.mjs compile   parts.jsonl -> compiled.jsonl (every part, compiled + stats)
//   node scripts/deepcad_library/build.mjs select    compiled.jsonl + texts.jsonl -> data/deepcad_library.json.gz
//
// Inputs come from scripts/deepcad_library/download.py and extract.py (in .text2cad/data, git-ignored).
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileCadSequenceToFeatureScript } from '../../deepcadCompiler.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA = path.join(ROOT, '.text2cad', 'data');
const LIBRARY_LIMIT = Number(process.env.DEEPCAD_LIBRARY_LIMIT || 12000);

async function* lines(file) {
  const reader = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of reader) if (line.trim()) yield JSON.parse(line);
}

const round = value => (typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : Array.isArray(value) ? value.map(round) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, round(v)])) : value);

async function compileAll() {
  const out = createWriteStream(path.join(DATA, 'compiled.jsonl'));
  let total = 0, ok = 0;
  const failures = new Map();
  for await (const { uid, json } of lines(path.join(DATA, 'parts.jsonl'))) {
    total += 1;
    let result;
    try {
      result = compileCadSequenceToFeatureScript(json, { featureName: 'deepcadPart' });
    } catch (err) {
      result = { ok: false, errors: [`exception: ${err.message}`] };
    }
    if (!result.ok) {
      const reason = String(result.errors?.[0] || 'unknown').replace(/\d+(\.\d+)?/g, '#').slice(0, 90);
      failures.set(reason, (failures.get(reason) || 0) + 1);
      continue;
    }
    ok += 1;
    const steps = result.sequence.steps;
    const kinds = [...new Set(steps.flatMap(s => s.faces.flatMap(f => f.loops.flat().map(c => c.type))))];
    const ops = steps.map(s => s.extrude.operation);
    out.write(JSON.stringify({ uid, steps: steps.length, kinds, ops, sequence: round(result.sequence) }) + '\n');
    if (total % 20000 === 0) console.log(`  ${total} parts, ${ok} compiled`);
  }
  out.end();
  console.log(`compiled ${ok}/${total} parts`);
  console.log('top failure reasons:');
  for (const [reason, count] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${count}  ${reason}`);
}

const normalize = text => String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function select() {
  const texts = new Map();
  for await (const row of lines(path.join(DATA, 'texts.jsonl'))) texts.set(row.uid, row);
  // Group compiled parts by their normalized abstract (many parts share a name, e.g. "a cylindrical object").
  const groups = new Map();
  for await (const part of lines(path.join(DATA, 'compiled.jsonl'))) {
    const text = texts.get(part.uid);
    if (!text) continue;
    const key = normalize(text.abstract);
    if (!key || key.split(' ').length < 2) continue;
    const entry = { ...part, abstract: text.abstract, keywords: text.keywords, beginner: text.beginner };
    const group = groups.get(key);
    if (!group) groups.set(key, { count: 1, best: entry });
    else {
      group.count += 1;
      // Prefer the simplest representative: fewer steps, then fewer curves.
      const size = e => e.steps * 100 + JSON.stringify(e.sequence).length / 1000;
      if (size(entry) < size(group.best)) group.best = entry;
    }
  }
  // Keep the most common descriptions (well-represented shapes) up to the limit.
  const chosen = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, LIBRARY_LIMIT);
  // Two files so the server stays small (Render's free tier has 512 MB): a compact search
  // index loaded into memory, and a blob of individually compressed sequences that is read
  // from disk (by byte offset) only for the part that matches.
  const blobs = [];
  let offset = 0;
  const library = chosen.map(({ count, best }) => {
    const blob = deflateRawSync(JSON.stringify(best.sequence), { level: 9 });
    blobs.push(blob);
    const entry = {
      uid: best.uid,
      name: best.abstract.slice(0, 220),
      keywords: best.keywords.replace(/[[\]']/g, '').slice(0, 160),
      count,
      kinds: best.kinds,
      ops: best.ops,
      at: offset,
      len: blob.length,
    };
    offset += blob.length;
    return entry;
  });
  const index = JSON.stringify({ format: 'deepcad-library/v2', source: 'Text2CAD v1.1 + DeepCAD (CC BY-NC-SA 4.0)', parts: library });
  writeFileSync(path.join(ROOT, 'data', 'deepcad_library_index.json.gz'), gzipSync(index, { level: 9 }));
  writeFileSync(path.join(ROOT, 'data', 'deepcad_library_shapes.bin'), Buffer.concat(blobs));
  const curved = library.filter(p => p.kinds.some(k => k !== 'line')).length;
  console.log(`groups ${groups.size}; library ${library.length} parts (${curved} with arcs/circles); index ${(index.length / 1e6).toFixed(1)} MB json, shapes ${(offset / 1e6).toFixed(1)} MB`);
}

const mode = process.argv[2] || 'compile';
if (mode === 'compile') await compileAll();
else if (mode === 'select') await select();
