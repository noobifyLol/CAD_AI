/**
 * benchcadParts.js: standard parts with exact, verified geometry (data/benchcad_fs.json.gz).
 *
 * 256 BenchCAD parts in 86 families (hex nut, washer, pipe flange, pillow block, chair, phone
 * stand, ...) converted from their CadQuery programs to FeatureScript by scripts/benchcad_fs;
 * each one matches CadQuery's volume within 1.5 %. A prompt that simply names one of these
 * parts gets it directly: no AI call, nothing to go wrong.
 *
 * Matching is strict on purpose. Every word of the prompt must be part of the family's name
 * (or a word that does not change the shape, like "small" or "metal"), so "a hex nut" or "a
 * pipe flange" match, while "a pipe flange with 6 bolt holes" or "a phone stand with a cable
 * hole" ask for something specific and go to the AI, which builds exactly that.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

let library = null;
function load() {
  if (library) return library;
  try {
    const file = fileURLToPath(new URL("./data/benchcad_fs.json.gz", import.meta.url));
    library = existsSync(file) ? JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")).parts || [] : [];
  } catch {
    library = [];
  }
  return library;
}

// Words that say nothing about the shape.
const FILLER = new Set(("a an the one some of for me my please make create design model draw generate build give need want "
  + "i can you could would like part cad onshape featurescript simple basic standard small large big little typical normal "
  + "plain regular metal steel aluminum aluminium plastic brass wooden wood printed 3d printable").split(" "));
// Use words that do not change the geometry of these parts ("a coat hook" is a J hook).
const CONTEXT = new Set("coat wall door desk office kitchen garden bathroom garage electronics electronic electrical project".split(" "));
// The usual kind when the prompt only names the general thing ("a bracket" is an L bracket).
const DEFAULT_FAMILY = { bracket: "l_bracket", nut: "hex_nut", hook: "j_hook", knob: "ball_knob", standoff: "hex_standoff", pin: "dowel_pin" };
// Spellings people use for a family word.
const ALIASES = { nuts: "nut", washers: "washer", bolts: "bolt", hooks: "hook", ibeam: "i", beam: "beam", hexagon: "hex", hexagonal: "hex", l: "l", "l-bracket": "l", j: "j", u: "u", t: "t", pins: "pin", knobs: "knob", standoffs: "standoff", spacers: "spacer", brackets: "bracket", chairs: "chair", tables: "table", pulleys: "pulley", hinges: "hinge" };

function words(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean).map(w => ALIASES[w] || w);
}

/**
 * The verified standard part a prompt names, or null. Returns { family, variant, label, code }.
 * The most detailed variant (most operations) of the best family is used.
 */
export function benchcadPart(prompt) {
  const text = String(prompt || "");
  if (/\d/.test(text)) return null; // sizes or counts asked for: build them exactly instead
  const asked = words(text).filter(w => !FILLER.has(w));
  if (!asked.length || asked.length > 4) return null;
  const parts = load();
  let best = null;
  for (const family of new Set(parts.map(p => p.family))) {
    const name = family.split("_");
    // The thing asked for is the family's main noun ("phone stand" is a stand, "hex nut" a nut).
    const head = asked.filter(w => !CONTEXT.has(w)).pop();
    if (head !== name[name.length - 1]) continue;
    if (!asked.every(w => name.includes(w) || CONTEXT.has(w))) continue;
    const covered = name.filter(w => asked.includes(w)).length;
    const extra = name.length - covered; // family words the prompt did not say ("a nut" -> hex nut: 1)
    if (extra > 1) continue;
    const score = covered * 10 - extra * 3 - name.length + (DEFAULT_FAMILY[head] === family ? 1 : 0);
    if (!best || score > best.score) best = { family, score };
  }
  if (!best) return null;
  const variants = parts.filter(p => p.family === best.family).sort((a, b) => b.ops - a.ops);
  const part = variants[0];
  const label = best.family.split("_").map(w => w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(" ");
  return { family: best.family, variant: part.variant, standard: part.standard, label, code: part.code };
}

export function benchcadInfo() {
  const parts = load();
  return { parts: parts.length, families: new Set(parts.map(p => p.family)).size };
}
