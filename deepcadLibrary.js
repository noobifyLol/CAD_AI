/**
 * deepcadLibrary.js: prompt -> closest real DeepCAD part -> FeatureScript.
 *
 * data/deepcad_library.json.gz holds ~30k real parts from the DeepCAD dataset with their
 * Text2CAD descriptions (built by scripts/deepcad_library/build.mjs). Every part already
 * compiled with deepcadCompiler.js. Matching is BM25 over the part's name + keywords; a
 * candidate is only used when it covers the prompt's important words AND passes the same
 * "did it leave something out?" check as the DeepCAD model (hole counts, slots, L/T/U
 * profiles, stacked features). No model, no credits: instant and free.
 *
 * Data license: Text2CAD / DeepCAD, CC BY-NC-SA 4.0 (non-commercial).
 */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const LIBRARY_FILE = fileURLToPath(new URL("./data/deepcad_library.json.gz", import.meta.url));
const MIN_COVERAGE = Number(process.env.DEEPCAD_LIBRARY_MIN_COVERAGE || 0.75);

const STOPWORDS = new Set(("a an the and or of with without to for in on at by from into onto is are be it its this that "
  + "object shape part model cad design make create build generate me please can you i want need some one "
  + "has have having which where while each other also very slightly small large big simple basic").split(" "));

const stem = word => word.length > 4 && word.endsWith("es") && /(ch|sh|x|ss)es$/.test(word) ? word.slice(0, -2)
  : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;

export function tokenize(text) {
  return String(text || "").toLowerCase().replace(/[-_]/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter(word => word && !STOPWORDS.has(word) && !/^\d+(\.\d+)?$/.test(word) && !/^(mm|cm|in|inch|inches|ft)$/.test(word))
    .map(stem);
}

let index = null;

function load() {
  if (index) return index;
  if (!existsSync(LIBRARY_FILE)) {
    index = { parts: [], df: new Map(), avgLength: 1 };
    return index;
  }
  const { parts } = JSON.parse(gunzipSync(readFileSync(LIBRARY_FILE)).toString("utf8"));
  const df = new Map();
  let totalLength = 0;
  for (const part of parts) {
    // Name counts twice: it is the most precise description.
    part.tokens = [...tokenize(part.name), ...tokenize(part.name), ...tokenize(part.keywords)];
    part.termCounts = new Map();
    for (const token of part.tokens) part.termCounts.set(token, (part.termCounts.get(token) || 0) + 1);
    totalLength += part.tokens.length;
    for (const token of part.termCounts.keys()) df.set(token, (df.get(token) || 0) + 1);
  }
  index = { parts, df, avgLength: totalLength / Math.max(1, parts.length) };
  return index;
}

export function libraryInfo() {
  const { parts } = load();
  return { available: parts.length > 0, parts: parts.length };
}

/** Top-k parts for a prompt: [{ part, score, coverage }], best first. */
export function searchLibrary(prompt, k = 12) {
  const { parts, df, avgLength } = load();
  const query = [...new Set(tokenize(prompt))];
  if (!parts.length || !query.length) return [];
  const N = parts.length;
  const idf = token => Math.log(1 + (N - (df.get(token) || 0) + 0.5) / ((df.get(token) || 0) + 0.5));
  const queryWeight = query.reduce((sum, token) => sum + idf(token), 0);
  const scored = [];
  for (const part of parts) {
    let score = 0;
    let covered = 0;
    for (const token of query) {
      const tf = part.termCounts.get(token);
      if (!tf) continue;
      covered += idf(token);
      score += idf(token) * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * part.tokens.length / avgLength));
    }
    if (score > 0) scored.push({ part, score, coverage: covered / queryWeight });
  }
  // Coverage first (does it mention what was asked?), then BM25, then popularity.
  scored.sort((a, b) => (b.coverage - a.coverage) || (b.score - a.score) || (b.part.count - a.part.count));
  return scored.slice(0, k);
}

/**
 * Best library part that covers the prompt and passes `accept(sequence)` (the caller's
 * missing-feature check). Returns { part, sequence, score, coverage } or null.
 */
export function matchLibraryPart(prompt, accept = () => true) {
  for (const candidate of searchLibrary(prompt)) {
    if (candidate.coverage < MIN_COVERAGE) break; // sorted by coverage: nothing better follows
    const sequence = JSON.parse(candidate.part.seq);
    if (!accept(sequence)) continue;
    return { part: candidate.part, sequence, score: candidate.score, coverage: candidate.coverage };
  }
  return null;
}
