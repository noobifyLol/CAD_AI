/**
 * featureScriptGeometry.js: offline geometry checks for generated FeatureScript.
 *
 * The static validator checks syntax; these checks catch the runtime failures Onshape
 * reports as "Cannot resolve entities", without needing the Onshape API:
 *
 *   1. Open sketch profiles. Every sketch used as a region (qSketchRegion) must close.
 *      Line/arc/spline endpoints are evaluated numerically with the dialog's default
 *      parameter values; an endpoint used by only one curve means a missing segment.
 *      (A spray bottle profile with axis, side and top lines but no bottom line.)
 *   2. Dangling references: qCreatedBy / qSketchRegion / qCapEntity naming an id that
 *      no operation or sketch in the feature creates.
 *
 * autoCloseOpenProfiles() repairs the common case of exactly one missing segment by
 * adding it with the same (parametric) endpoint expressions the model wrote.
 * Everything here is conservative: anything it cannot evaluate is skipped, never flagged.
 */

const UNIT_VALUES = { inch: 1, mm: 1 / 25.4, millimeter: 1 / 25.4, cm: 1 / 2.54, centimeter: 1 / 2.54, meter: 1 / 0.0254, foot: 12, radian: 1, degree: Math.PI / 180 };
const MATH_FUNCTIONS = new Set(["sqrt", "sin", "cos", "tan", "abs", "min", "max", "floor", "ceil", "round", "asin", "acos", "atan", "atan2"]);

/** Default value of every numeric dialog parameter ({ (inch) : [min, default, max] }). */
function parameterDefaults(code) {
  const values = {};
  const pattern = /\bis(Length|Integer|Real|Angle)\s*\(\s*definition\.(\w+)\s*,\s*\{\s*\((\w+)\)\s*:\s*\[\s*([^,\]]+),\s*([^,\]]+),\s*([^\]]+)\]/g;
  for (const match of code.matchAll(pattern)) {
    const unit = match[3];
    const value = Number(match[5]);
    if (!Number.isFinite(value)) continue;
    values[match[2]] = unit in UNIT_VALUES ? value * UNIT_VALUES[unit] : value;
  }
  return values;
}

/** Evaluate a FeatureScript arithmetic expression to a number, or null if it uses anything unknown. */
function evaluate(expression, env) {
  let unknown = false;
  const js = String(expression).replace(/\bdefinition\.(\w+)\b|\b([A-Za-z_]\w*)\b/g, (match, param, name) => {
    if (param) {
      if (param in env.params) return `(${env.params[param]})`;
      unknown = true;
      return "0";
    }
    if (name in UNIT_VALUES) return `(${UNIT_VALUES[name]})`;
    if (name === "PI") return `(${Math.PI})`;
    if (MATH_FUNCTIONS.has(name)) return `Math.${name}`;
    if (name === "Math") return "Math";
    if (name in env.vars) return `(${env.vars[name]})`;
    unknown = true;
    return "0";
  });
  // Only numbers, arithmetic and whitelisted Math calls may reach Function().
  if (unknown || /[^\d.eE+\-*/(),\s]|(?<![\w.])e/.test(js.replace(/Math\.\w+/g, ""))) return null;
  try {
    const value = Function(`"use strict"; return (${js});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Split "a, f(b, c), d" at top-level commas. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim());
}

/** Index of the bracket closing the one at `open`. */
function matchingClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if ("([{".includes(text[i])) depth += 1;
    else if (")]}".includes(text[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** "vector(a, b) * inch" (or "* someLength") -> { x, y, text } or null. */
function evaluatePoint(text, env) {
  const source = String(text).trim();
  const match = source.match(/^vector\s*\(/);
  if (!match) return null;
  const open = source.indexOf("(");
  const close = matchingClose(source, open);
  if (close < 0) return null;
  const args = splitTopLevel(source.slice(open + 1, close));
  if (args.length !== 2) return null;
  const rest = source.slice(close + 1).trim();
  let scale = 1;
  if (rest) {
    const factor = rest.match(/^\*\s*(.+)$/s);
    if (!factor) return null;
    scale = evaluate(factor[1], env);
    if (scale === null) return null;
  }
  const x = evaluate(args[0], env);
  const y = evaluate(args[1], env);
  if (x === null || y === null) return null;
  return { x: x * scale, y: y * scale, text: source };
}

/** Value of `"key" : <expression>` inside a map literal (top-level keys only). */
function mapEntry(mapText, key) {
  const inner = mapText.trim().replace(/^\{/, "").replace(/\}$/, "");
  for (const part of splitTopLevel(inner)) {
    const entry = part.match(/^"(\w+)"\s*:\s*([\s\S]+)$/);
    if (entry && entry[1] === key) return entry[2].trim();
  }
  return null;
}

/** Every sk*(sketchVar, "name", { ... }) call: { fn, sketch, map, start, end }. */
function sketchCalls(code) {
  const calls = [];
  const pattern = /\b(sk[A-Z]\w*)\s*\(\s*(\w+)\s*,\s*"([^"]*)"\s*,\s*\{/g;
  for (const match of code.matchAll(pattern)) {
    const braceAt = match.index + match[0].length - 1;
    const close = matchingClose(code, braceAt);
    if (close < 0) continue;
    calls.push({ fn: match[1], sketch: match[2], name: match[3], map: code.slice(braceAt, close + 1), start: match.index, end: close });
  }
  return calls;
}

function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

/** Sketch variable -> sketch id, for sketches whose regions are used by an operation. */
function regionSketches(code) {
  const sketches = {};
  for (const match of code.matchAll(/\bvar\s+(\w+)\s*=\s*newSketch(?:OnPlane)?\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)) {
    sketches[match[1]] = match[2];
  }
  const used = new Set([...code.matchAll(/qSketchRegion\s*\(\s*id\s*\+\s*"(\w+)"/g)].map(match => match[1]));
  return Object.fromEntries(Object.entries(sketches).filter(([, sketchId]) => used.has(sketchId)));
}

/** Numeric environment: dialog defaults plus top-level `var name = expr;` values in order. */
function buildEnv(code) {
  const env = { params: parameterDefaults(code), vars: {} };
  for (const match of code.matchAll(/^\s*var\s+(\w+)\s*=\s*([^;{}\n]+);/gm)) {
    const value = evaluate(match[2], env);
    if (value !== null) env.vars[match[1]] = value;
  }
  return env;
}

const pointKey = point => `${point.x.toFixed(5)},${point.y.toFixed(5)}`;

/**
 * Open-profile analysis per region sketch: { sketchVar, sketchId, dangling: [points], solveAt }.
 * Sketches with anything not evaluable (loops, unknown helpers) are skipped.
 */
function analyseProfiles(code) {
  const env = buildEnv(code);
  const results = [];
  const calls = sketchCalls(code);
  for (const [sketchVar, sketchId] of Object.entries(regionSketches(code))) {
    const mine = calls.filter(call => call.sketch === sketchVar);
    if (!mine.length) continue;
    const ends = [];
    let skip = false;
    for (const call of mine) {
      if (mapEntry(call.map, "construction") === "true") continue;
      if (call.fn === "skLineSegment" || call.fn === "skArc") {
        const a = evaluatePoint(mapEntry(call.map, "start") || "", env);
        const b = evaluatePoint(mapEntry(call.map, "end") || "", env);
        if (!a || !b) { skip = true; break; }
        ends.push(a, b);
      } else if (call.fn === "skFitSpline") {
        const points = mapEntry(call.map, "points");
        if (!points || !points.startsWith("[")) { skip = true; break; }
        const list = splitTopLevel(points.slice(1, -1)).filter(Boolean);
        const first = evaluatePoint(list[0] || "", env);
        const last = evaluatePoint(list[list.length - 1] || "", env);
        if (!first || !last) { skip = true; break; }
        if (pointKey(first) !== pointKey(last)) ends.push(first, last); // closed splines add nothing
      } else if (!["skCircle", "skRectangle", "skRegularPolygon", "skEllipse", "skSolve", "skPolyline", "skConstraint"].includes(call.fn)) {
        skip = true; // unknown curve type: do not guess
        break;
      }
    }
    // Calls inside loops reuse one source line many times; we cannot count those.
    if (skip || !ends.length || mine.some(call => /\bfor\s*\(/.test(code.slice(Math.max(0, call.start - 400), call.start).split(/\}\s*\n/).pop()))) continue;
    const counts = new Map();
    for (const point of ends) {
      const key = pointKey(point);
      counts.set(key, { point, count: (counts.get(key)?.count || 0) + 1 });
    }
    const dangling = [...counts.values()].filter(entry => entry.count % 2 === 1).map(entry => entry.point);
    if (dangling.length) {
      const solve = code.indexOf(`skSolve(${sketchVar})`, mine[mine.length - 1].end);
      results.push({ sketchVar, sketchId, dangling, solveAt: solve });
    }
  }
  return results;
}

/** Ids created by operations (op*(context, id + "x")) and sketches. */
function createdIds(code) {
  const ids = new Set();
  // Any call taking (context, id + "x") creates something under that id: op*, sketches,
  // std features (extrude, fillet, ...), and helper functions defined in the file.
  for (const match of code.matchAll(/\b\w+\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)) ids.add(match[1]);
  return ids;
}

/** Issues in the validator's shape: { line, message, text }. */
export function checkFeatureScriptGeometry(code) {
  const text = String(code || "");
  const issues = [];
  for (const profile of analyseProfiles(text)) {
    const points = profile.dangling.slice(0, 4).map(point => `(${+point.x.toFixed(3)}, ${+point.y.toFixed(3)})`).join(", ");
    issues.push({
      line: profile.solveAt >= 0 ? lineOf(text, profile.solveAt) : null,
      message: `Sketch "${profile.sketchId}" is not closed: the curve ends at ${points} (default sizes, inches) are not shared with another curve, so qSketchRegion finds no region and Onshape fails with "Cannot resolve entities". Add the missing segment(s) so the profile forms a closed loop.`,
      text: `skSolve(${profile.sketchVar})`,
    });
  }
  // End caps only exist on extrudes: qCapEntity on a revolve/loft/sweep id is empty.
  const opKinds = Object.fromEntries([...text.matchAll(/\b(op[A-Z]\w*|extrude|revolve|loft|sweep)\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)].map(match => [match[2], match[1]]));
  for (const match of text.matchAll(/qCapEntity\s*\(\s*id\s*\+\s*"(\w+)"/g)) {
    const kind = opKinds[match[1]];
    if (kind && !/^(opExtrude|extrude)$/.test(kind)) {
      issues.push({
        line: lineOf(text, match.index),
        message: `qCapEntity(id + "${match[1]}") asks for the end cap of a ${kind} body, but only extrudes have cap faces, so the query is empty ("Cannot resolve entities"). Select the face another way, or hollow the part with an inner body and opBoolean SUBTRACTION.`,
        text: match[0],
      });
    }
  }

  // Circles must have a positive radius at the default parameter values
  // (e.g. inner radius = outer radius - wall, with a wall default larger than the radius).
  const env = buildEnv(text);
  for (const call of sketchCalls(text).filter(c => c.fn === "skCircle")) {
    const radius = mapEntry(call.map, "radius");
    const value = radius === null ? null : evaluate(radius, env);
    if (value !== null && value <= 1e-9) {
      issues.push({
        line: lineOf(text, call.start),
        message: `Circle "${call.name}" has radius ${+value.toFixed(4)} in at the default parameter values; a sketch circle needs a positive radius, so the sketch fails. Check the parameter defaults and bounds (for example an inner radius computed as outer radius minus a wall thickness).`,
        text: `skCircle(${call.sketch}, "${call.name}", ...)`,
      });
    }
  }

  // Loop-generated ids (id + "tooth" ~ i) cannot be checked statically.
  if (!/\bid\s*\+\s*\([^)]*~|\bid\s*\+\s*"\w*"\s*~/.test(text)) {
    const created = createdIds(text);
    const seen = new Set();
    for (const match of text.matchAll(/\b(qCreatedBy|qSketchRegion|qCapEntity)\s*\(\s*id\s*\+\s*"(\w+)"/g)) {
      const ref = match[2];
      if (created.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      issues.push({
        line: lineOf(text, match.index),
        message: `${match[1]}(id + "${ref}") refers to "${ref}", but no operation or sketch in this feature uses that id, so the query is empty and Onshape fails with "Cannot resolve entities".`,
        text: match[0],
      });
    }
  }
  return issues;
}

/**
 * Close profiles that are missing exactly one segment by adding it before skSolve,
 * using the model's own endpoint expressions so the part stays parametric.
 * Returns { code, closed: [sketchId, ...] }.
 */
export function autoCloseOpenProfiles(code) {
  let text = String(code || "");
  const closed = [];
  // Work from the end of the file so earlier insert positions stay valid.
  const profiles = analyseProfiles(text).filter(profile => profile.dangling.length === 2 && profile.solveAt >= 0).sort((a, b) => b.solveAt - a.solveAt);
  for (const profile of profiles) {
    const [a, b] = profile.dangling;
    const indent = (text.slice(text.lastIndexOf("\n", profile.solveAt) + 1, profile.solveAt).match(/^\s*/) || [""])[0];
    const segment = `skLineSegment(${profile.sketchVar}, "autoClose", {\n${indent}    "start" : ${a.text},\n${indent}    "end"   : ${b.text}\n${indent}});\n${indent}`;
    text = text.slice(0, profile.solveAt) + segment + text.slice(profile.solveAt);
    closed.push(profile.sketchId);
  }
  return { code: text, closed };
}
