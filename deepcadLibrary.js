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
import { deflateRawSync, gunzipSync, inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const LIBRARY_FILE = fileURLToPath(new URL("./data/deepcad_library.json.gz", import.meta.url));
const MIN_COVERAGE = Number(process.env.DEEPCAD_LIBRARY_MIN_COVERAGE || 0.75);

const STOPWORDS = new Set(("a an the and or of with without to for in on at by from into onto is are be it its this that "
  + "object shape part model cad design make create build generate me please can you i want need some one "
  + "has have having which where while each other also very slightly small large big simple basic "
  // dimension words describe sizes, not the shape ("80 mm wide" must not block a match)
  + "wide long tall thick high deep diameter radius width length height thickness depth size dimension dimensions").split(" "));

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
  const { parts: raw } = JSON.parse(gunzipSync(readFileSync(LIBRARY_FILE)).toString("utf8"));
  const df = new Map();
  let totalLength = 0;
  // Keep only what search needs (Render's free tier has 512 MB): name, counts, sequence string.
  const parts = raw.map(part => {
    const nameTokens = tokenize(part.name);
    const tokens = [...nameTokens, ...nameTokens, ...tokenize(part.keywords)]; // name counts twice
    const termCounts = {};
    for (const token of tokens) termCounts[token] = (termCounts[token] || 0) + 1;
    totalLength += tokens.length;
    for (const token of Object.keys(termCounts)) df.set(token, (df.get(token) || 0) + 1);
    return {
      uid: part.uid, name: part.name, count: part.count, kinds: part.kinds, ops: part.ops,
      seq: deflateRawSync(part.seq), // ~4x smaller in memory; inflated only for the chosen part
      termCounts, length: tokens.length, nameTokens: [...new Set(nameTokens)], head: headNoun(part.name),
    };
  });
  index = { parts, df, avgLength: totalLength / Math.max(1, parts.length) };
  return index;
}

export function libraryInfo() {
  const { parts } = load();
  return { available: parts.length > 0, parts: parts.length };
}

const COUNT_WORDS = { one: 1, single: 1, two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

/** "four bolt holes" -> Map { "hole" => 4 } (count before a noun, up to two words apart). */
function countedNouns(text) {
  const counts = new Map();
  const words = String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/);
  words.forEach((word, i) => {
    const value = COUNT_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : null);
    if (value === null) return;
    for (const next of words.slice(i + 1, i + 4)) {
      if (/^(mm|cm|in|inch|inches|ft)$/.test(next)) return; // a size, not a count
      const noun = stem(next);
      if (!STOPWORDS.has(next) && /^[a-z]{3,}$/.test(next) && !["evenly", "spaced", "equally", "small", "large", "circular", "round", "bolt", "screw", "mounting"].includes(next)) {
        counts.set(noun, value);
        return;
      }
    }
  });
  return counts;
}

/**
 * The phrase's head noun: last content word before "with/for/that/..." in the first
 * sentence ("A wall shelf bracket with ..." -> bracket; "The object is a curved, L-shaped
 * bracket with two holes" -> bracket). Shape adjectives at the end are skipped.
 */
function headNoun(text) {
  const firstSentence = String(text || "").toLowerCase().split(/[.;]/)[0];
  const first = firstSentence.split(/\b(?:with|for|that|which|having|where|made|in|on|at|of|and|featuring|consisting)\b/)[0];
  const tokens = tokenize(first).filter(token => !/^(shaped|like|style|type)$/.test(token));
  return tokens[tokens.length - 1] || null;
}

/** Top-k parts for a prompt: [{ part, score, coverage }], best first. */
export function searchLibrary(prompt, k = 12) {
  const { parts, df, avgLength } = load();
  const query = [...new Set(tokenize(prompt))];
  if (!parts.length || !query.length) return [];
  const head = headNoun(prompt);
  const promptCounts = countedNouns(prompt);
  const N = parts.length;
  const idf = token => Math.log(1 + (N - (df.get(token) || 0) + 0.5) / ((df.get(token) || 0) + 0.5));
  const queryWeight = query.reduce((sum, token) => sum + idf(token), 0);
  const scored = [];
  for (const part of parts) {
    // The thing asked for must be the part's own main noun, not something it merely has:
    // "a handle" must not match "a bag with a handle"; "shelf bracket" is a bracket.
    if (head && part.head !== head) continue;
    let score = 0;
    let covered = 0;
    for (const token of query) {
      const tf = part.termCounts[token];
      if (!tf) continue;
      covered += idf(token);
      score += idf(token) * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * part.length / avgLength));
    }
    if (score <= 0) continue;
    // Counts must agree: "four bolt holes" must not match "three bolt holes".
    const partCounts = countedNouns(part.name);
    if ([...promptCounts].some(([noun, value]) => partCounts.has(noun) && partCounts.get(noun) !== value)) continue;
    // Precision: share of the part's name the prompt accounts for ("a washer" should prefer
    // "a flat washer" over "a series of washers arranged in a sequence").
    let named = 0;
    for (const token of part.nameTokens) if (query.includes(token)) named += 1;
    const precision = named / Math.max(1, part.nameTokens.length);
    scored.push({ part, score: score * (0.4 + 0.6 * precision), coverage: covered / queryWeight, precision });
  }
  // Coverage first (does it mention what was asked?), then precision-weighted BM25, then popularity.
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
    const sequence = JSON.parse(inflateRawSync(candidate.part.seq).toString("utf8"));
    if (!accept(sequence)) continue;
    return { part: candidate.part, sequence, score: candidate.score, coverage: candidate.coverage };
  }
  return null;
}
