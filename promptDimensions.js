/**
 * promptDimensions.js — deterministic (no LLM) reading of sizes and counts in a prompt,
 * and applying them to a library example's dialog parameters.
 *
 * Used when AI generation is unavailable, so "a wheel with 8 spokes, 6 inch diameter"
 * returns the wheel example with spokeCount = 8 and rimRadius = 3 in (other sizes
 * scaled to match) instead of the example's stock defaults.
 */

const UNIT_INCHES = {
  mm: 1 / 25.4, millimeter: 1 / 25.4, millimeters: 1 / 25.4, millimetre: 1 / 25.4, millimetres: 1 / 25.4,
  cm: 1 / 2.54, centimeter: 1 / 2.54, centimeters: 1 / 2.54, centimetre: 1 / 2.54, centimetres: 1 / 2.54,
  m: 1 / 0.0254, meter: 1 / 0.0254, meters: 1 / 0.0254, metre: 1 / 0.0254, metres: 1 / 0.0254,
  in: 1, inch: 1, inches: 1, '"': 1, "”": 1, ft: 12, foot: 12, feet: 12,
};
const UNIT_PATTERN = "millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|inch(?:es)?|feet|foot|mm|cm|in|ft|m|\"|”";
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20, "twenty-four": 24, thirty: 30, forty: 40,
};

// Things that get counted, mapped to the parameter-name fragments that hold them.
const COUNT_NOUNS = [
  { pattern: /^spokes?$/, params: [/spoke/i] },
  { pattern: /^(teeth|tooth|cogs?)$/, params: [/teeth|tooth/i] },
  { pattern: /^fins?$/, params: [/fin/i] },
  { pattern: /^(bolts?|bolt holes?|holes?|screw holes?)$/, params: [/bolt|hole/i] },
  { pattern: /^(bosses|boss|pegs?|pins?|studs?)$/, params: [/boss|instance|peg|pin|stud/i] },
  { pattern: /^(grooves?|ridges?|flutes?|knurls?)$/, params: [/groove|ridge|flute|knurl/i] },
  { pattern: /^(sides?|faces?)$/, params: [/side/i] },
  { pattern: /^(blades?|ribs?|slots?|vanes?)$/, params: [/blade|rib|slot|vane/i] },
];

// Words after (or just before) a measurement that say what it measures.
const ROLE_WORDS = [
  { role: "acrossFlats", pattern: /\bacross[\s-]*flats?\b|\bAF\b/i },
  { role: "innerDiameter", pattern: /\b(inner|inside|internal)\s+(diameter|dia)\b|\bI\.?D\.?\b|\b(hole|bore|opening|center hole|centre hole)\b/i },
  { role: "innerRadius", pattern: /\b(inner|inside|hole|bore)\s+radius\b/i },
  { role: "diameter", pattern: /\b(outer|outside|overall)?\s*(diameter|dia)\b|\bO\.?D\.?\b|\bØ/i },
  { role: "radius", pattern: /\bradius\b/i },
  { role: "cube", pattern: /^\s*(?:-|\s)?(?:sided\s+)?cubes?\b/i },
  { role: "wall", pattern: /\bwalls?\b/i },
  { role: "thickness", pattern: /\bthick(ness)?\b/i },
  { role: "height", pattern: /\b(tall|high|height)\b/i },
  { role: "length", pattern: /\b(long|length)\b/i },
  { role: "width", pattern: /\b(wide|width)\b/i },
  { role: "depth", pattern: /\b(deep|depth)\b/i },
];

const INNER_PARAM = /bore|hole|inner|axle|minor|neck|tip|tube|flat/i;
const DETAIL_PARAM = /spoke|clip|chamfer|groove|border|fin|fillet|wall|flat|tip|neck|handle|boss|hole|bore|axle|inset|spacing|post|key/i;

function toNumber(token) {
  const lower = String(token).toLowerCase();
  return lower in NUMBER_WORDS ? NUMBER_WORDS[lower] : Number(lower);
}

/**
 * Reads explicit sizes and counts from a prompt.
 * Returns { lengths: [{ inches, role }], counts: [{ count, noun }], triple: [inches...] | null, threadDiameter }
 */
export function parsePromptMeasurements(prompt) {
  const text = String(prompt || "");
  const result = { lengths: [], counts: [], triple: null, threadDiameter: null };

  // Default unit for bare numbers: the unit the prompt uses most, else inches.
  const unitHits = [...text.matchAll(new RegExp(`\\d\\s*(${UNIT_PATTERN})(?![a-z])`, "gi"))].map(m => m[1].toLowerCase());
  const tally = {};
  for (const unit of unitHits) tally[UNIT_INCHES[unit]] = (tally[UNIT_INCHES[unit]] || 0) + 1;
  const defaultScale = Number(Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || 1);

  // Metric thread size: "M10 bolt" → 10 mm nominal diameter.
  const thread = text.match(/\bM(\d+(?:\.\d+)?)\b/);
  if (thread) result.threadDiameter = Number(thread[1]) / 25.4;

  // Counts: "8 spokes", "six teeth", "24-tooth".
  const countRe = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|sixteen|eighteen|twenty|twenty-four|thirty|forty)[\s-]+((?:bolt |screw )?[a-z]+)/gi;
  for (const match of text.matchAll(countRe)) {
    const noun = match[2].toLowerCase();
    if (COUNT_NOUNS.some(entry => entry.pattern.test(noun))) {
      result.counts.push({ count: toNumber(match[1]), noun });
    }
  }

  // "A x B (x C) unit" — overall dimensions, in the order given.
  const tripleRe = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})?\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})?(?:\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})?)?(?![a-z\\d])`,
    "i",
  );
  const triple = text.match(tripleRe);
  let tripleSpan = null;
  if (triple) {
    const lastUnit = (triple[6] || triple[4] || triple[2] || "").toLowerCase();
    const scaleFor = unit => (unit ? UNIT_INCHES[unit.toLowerCase()] : lastUnit ? UNIT_INCHES[lastUnit] : defaultScale);
    result.triple = [[triple[1], triple[2]], [triple[3], triple[4]], [triple[5], triple[6]]]
      .filter(([value]) => value !== undefined)
      .map(([value, unit]) => Number(value) * scaleFor(unit));
    tripleSpan = [triple.index, triple.index + triple[0].length];
  }

  // Single measurements with a role word right after them (or right before).
  const lengthRe = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})?(?![a-z\\d])`, "gi");
  const numbers = [...text.matchAll(lengthRe)];
  numbers.forEach((match, index) => {
    const start = match.index;
    const end = start + match[0].length;
    if (tripleSpan && start >= tripleSpan[0] && end <= tripleSpan[1]) return;
    if (thread && start === thread.index + 1) return; // the "10" of "M10"
    const after = text.slice(end, numbers[index + 1]?.index ?? text.length).slice(0, 40);
    if (result.counts.some(c => new RegExp(`^[\\s-]*${c.noun}`, "i").test(after))) return; // it was a count
    const before = text.slice(index ? numbers[index - 1].index + numbers[index - 1][0].length : 0, start).slice(-30);
    const roleAfter = ROLE_WORDS.find(entry => entry.pattern.test(after.split(/\b(?:and|with|,)\b|,/i)[0]));
    const roleBefore = ROLE_WORDS.find(entry => entry.pattern.test(before.split(/\b(?:and|with)\b|,/i).pop()));
    const role = (roleAfter || roleBefore)?.role;
    if (!role) return;
    const scale = match[2] ? UNIT_INCHES[match[2].toLowerCase()] : defaultScale;
    result.lengths.push({ inches: Number(match[1]) * scale, role });
  });
  return result;
}

/** Dimension hints in the shape extractDims returns, for when the LLM is unavailable. */
export function promptDimsFallback(prompt) {
  const parsed = parsePromptMeasurements(prompt);
  const dims = {};
  const byRole = role => parsed.lengths.find(entry => entry.role === role)?.inches;
  const teeth = parsed.counts.find(c => /teeth|tooth|cog/.test(c.noun));
  if (teeth) dims.numTeeth = teeth.count;
  const holes = parsed.counts.find(c => /hole|bolt/.test(c.noun));
  if (holes) dims.numHoles = holes.count;
  const sides = parsed.counts.find(c => /side|face/.test(c.noun));
  if (sides) dims.sides = sides.count;
  const diameter = byRole("diameter") ?? byRole("acrossFlats") ?? parsed.threadDiameter;
  const radius = byRole("radius") ?? (diameter ? diameter / 2 : undefined);
  if (radius) dims.radiusInches = radius;
  const hole = byRole("innerRadius") ?? (byRole("innerDiameter") ? byRole("innerDiameter") / 2 : undefined);
  if (hole) dims.holeRadiusInches = hole;
  if (parsed.triple) {
    [dims.widthInches, dims.heightInches, dims.depthInches] = parsed.triple;
  }
  if (byRole("width")) dims.widthInches = byRole("width");
  if (byRole("height")) dims.heightInches = byRole("height");
  if (byRole("depth") ?? byRole("thickness")) dims.depthInches = byRole("depth") ?? byRole("thickness");
  if (byRole("length")) dims.shaftLengthInches = byRole("length");
  if (byRole("wall")) dims.wallThicknessInches = byRole("wall");
  if (byRole("cube")) dims.widthInches = dims.heightInches = dims.depthInches = byRole("cube");
  return dims;
}

// ─── applying values to an example's dialog parameters ──────────────────────

const PARAM_RE = /(is(Length|Integer))\(definition\.(\w+),\s*\{\s*\((inch|unitless)\)\s*:\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]\s*\}\s*as\s*(\w+)\s*\)/g;

function listParams(code) {
  return [...code.matchAll(PARAM_RE)].map(m => ({
    kind: m[2] === "Length" ? "length" : "integer",
    name: m[3],
    min: Number(m[5]),
    def: Number(m[6]),
    max: Number(m[7]),
  }));
}

const largest = params => [...params].sort((a, b) => b.def - a.def)[0];

function pickParam(params, used, { include, exclude, kind = "length" }) {
  const candidates = params.filter(p => p.kind === kind && !used.has(p.name) && include.test(p.name) && !(exclude && exclude.test(p.name)));
  return largest(candidates);
}

const round = value => Number(Number(value).toPrecision(4));

/**
 * Sets the example's parameter defaults from the prompt. Unmentioned sizes are
 * scaled by the same factor as the main size the prompt gave, so proportions hold.
 * Returns { code, applied: [{ name, value, source }] } — code unchanged if nothing applied.
 */
export function applyPromptToExample(code, prompt) {
  const params = listParams(code);
  if (!params.length) return { code, applied: [] };
  const parsed = parsePromptMeasurements(prompt);
  const values = new Map(); // name -> value
  const used = new Set();
  let primary = null; // { name, ratio }
  const set = (param, value, isPrimary = false) => {
    if (!param || !(value > 0)) return;
    values.set(param.name, value);
    used.add(param.name);
    if (isPrimary && !primary && param.def > 0) primary = { name: param.name, ratio: value / param.def };
  };
  const radiusParams = params.filter(p => p.kind === "length" && /radius/i.test(p.name));

  // Counts.
  for (const { count, noun } of parsed.counts) {
    const entry = COUNT_NOUNS.find(c => c.pattern.test(noun));
    let param = params.find(p => p.kind === "integer" && !used.has(p.name) && entry.params.some(re => re.test(p.name)));
    const integers = params.filter(p => p.kind === "integer");
    if (!param && integers.length === 1 && !used.has(integers[0].name)) param = integers[0];
    if (param) set(param, Math.round(count));
  }

  // Overall dimensions "A x B (x C)", assigned to the main planar sizes in order.
  if (parsed.triple) {
    const slots = [/width|length/i, /depth|height/i, /height|thickness/i];
    parsed.triple.forEach((value, index) => {
      set(pickParam(params, used, { include: slots[index], exclude: DETAIL_PARAM }), value, index === 0);
    });
  }

  for (const { inches, role } of parsed.lengths) {
    if (role === "diameter" || role === "radius") {
      const target = largest(radiusParams.filter(p => !used.has(p.name) && !INNER_PARAM.test(p.name))) ||
        largest(radiusParams.filter(p => !used.has(p.name)));
      set(target, role === "diameter" ? inches / 2 : inches, true);
    } else if (role === "innerDiameter" || role === "innerRadius") {
      const target = largest(radiusParams.filter(p => !used.has(p.name) && /bore|hole|inner|axle/i.test(p.name)));
      set(target, role === "innerDiameter" ? inches / 2 : inches);
    } else if (role === "acrossFlats") {
      set(pickParam(params, used, { include: /acrossFlats|headWidth|flats/i }), inches, true);
    } else if (role === "wall") {
      set(pickParam(params, used, { include: /wall/i }), inches);
    } else if (role === "thickness") {
      set(pickParam(params, used, { include: /thickness/i, exclude: /wall|fin|leg|handle/i }) ||
        pickParam(params, used, { include: /thickness|depth|height/i, exclude: /fin|handle/i }), inches);
    } else if (role === "height") {
      set(pickParam(params, used, { include: /height/i, exclude: DETAIL_PARAM }) ||
        pickParam(params, used, { include: /length/i, exclude: DETAIL_PARAM }) ||
        pickParam(params, used, { include: /height|length/i }), inches, true);
    } else if (role === "length") {
      set(pickParam(params, used, { include: /length/i, exclude: DETAIL_PARAM }) ||
        pickParam(params, used, { include: /height|width/i, exclude: DETAIL_PARAM }), inches, true);
    } else if (role === "width") {
      set(pickParam(params, used, { include: /width/i, exclude: DETAIL_PARAM }), inches, true);
    } else if (role === "depth") {
      set(pickParam(params, used, { include: /depth/i, exclude: DETAIL_PARAM }), inches, true);
    }
  }

  // "M10 bolt": the thread is the shaft (or a nut's bore).
  if (parsed.threadDiameter) {
    set(pickParam(params, used, { include: /shaft.*radius|bore.*radius|major.*radius/i }), parsed.threadDiameter / 2, true);
  }

  if (!values.size) return { code, applied: [] };

  const applied = [...values].map(([name, value]) => ({ name, value: round(value), source: "prompt" }));
  if (primary && Math.abs(primary.ratio - 1) > 1e-6) {
    for (const param of params) {
      if (param.kind !== "length" || values.has(param.name)) continue;
      const scaled = param.def * primary.ratio;
      values.set(param.name, scaled);
      applied.push({ name: param.name, value: round(scaled), source: `scaled ×${round(primary.ratio)}` });
    }
  }

  // Keep holes smaller than the part they are cut into.
  const outer = largest(radiusParams.filter(p => !INNER_PARAM.test(p.name)));
  if (outer) {
    const outerValue = values.get(outer.name) ?? outer.def;
    for (const param of radiusParams.filter(p => /bore|hole|axle|inner/i.test(p.name))) {
      const value = values.get(param.name) ?? param.def;
      if (value >= outerValue * 0.9) {
        values.set(param.name, outerValue * 0.5);
        const entry = applied.find(a => a.name === param.name);
        if (entry) Object.assign(entry, { value: round(outerValue * 0.5), source: "reduced to fit" });
        else applied.push({ name: param.name, value: round(outerValue * 0.5), source: "reduced to fit" });
      }
    }
  }

  // Linear patterns: n items at `spacing` steps from one edge must stay on the base.
  const countParam = params.find(p => p.kind === "integer" && /count/i.test(p.name));
  const spacingParam = params.find(p => p.kind === "length" && /spacing/i.test(p.name));
  const widthParam = params.find(p => p.kind === "length" && /^(base)?width$/i.test(p.name));
  if (countParam && spacingParam && widthParam && values.has(countParam.name)) {
    const count = values.get(countParam.name);
    const width = values.get(widthParam.name) ?? widthParam.def;
    const itemParam = params.find(p => p.kind === "length" && /thickness/i.test(p.name) && !/base/i.test(p.name));
    const item = itemParam ? values.get(itemParam.name) ?? itemParam.def : 0;
    const spacing = values.get(spacingParam.name) ?? spacingParam.def;
    const fits = count > 1 ? (width - item) / (count - 1) : spacing;
    if (spacing > fits) {
      const reduced = fits * 0.999; // stay inside after rounding
      values.set(spacingParam.name, reduced);
      const entry = applied.find(a => a.name === spacingParam.name);
      if (entry) Object.assign(entry, { value: round(reduced), source: "reduced to fit" });
      else applied.push({ name: spacingParam.name, value: round(reduced), source: "reduced to fit" });
    }
  }

  const updated = code.replace(PARAM_RE, (whole, call, _kind, name, unit, min, def, max, spec) => {
    if (!values.has(name)) return whole;
    const value = unit === "unitless" ? Math.round(values.get(name)) : round(values.get(name));
    const lo = Math.min(Number(min), unit === "unitless" ? value : round(value / 2));
    const hi = Math.max(Number(max), unit === "unitless" ? value : round(value * 2));
    return `${call}(definition.${name}, { (${unit}) : [${lo}, ${value}, ${hi}] } as ${spec})`;
  });
  return { code: updated, applied };
}

const FILLER_WORDS = new Set(["a", "an", "the", "create", "make", "build", "design", "generate", "model", "me", "please", "of", "simple", "basic"]);

/** "create a spur gear with 24 teeth" → { featureName: "spurGear", featureLabel: "Spur Gear" } */
export function promptFeatureNames(prompt) {
  const words = String(prompt || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const isMeasure = word => /^\d/.test(word) || ["x", "by", "mm", "cm", "m", "in", "inch", "inches", "ft", "feet", "foot", "thick", "tall", "long", "wide", "high", "deep", "diameter", "dia", "radius", "across", "flats", "outer", "inner"].includes(word);
  const start = words.findIndex(word => !FILLER_WORDS.has(word) && !isMeasure(word));
  const picked = [];
  for (const word of words.slice(Math.max(start, 0))) {
    if (["with", "and", "that", "which", "for", "having", "of"].includes(word) || /^\d/.test(word)) break;
    picked.push(word.replace(/-/g, ""));
    if (picked.length === 3) break;
  }
  if (!picked.length) return { featureName: "customFeature", featureLabel: "Custom Feature" };
  const label = picked.map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
  const name = picked.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word)).join("");
  return { featureName: /^[a-z]/.test(name) ? name : `part${name}`, featureLabel: label };
}
