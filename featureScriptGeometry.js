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
const EPS = 1e-5;
const samePoint = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < EPS;

/** Circle through three points, or null when they are collinear. */
function circleThrough(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const sq = p => p.x * p.x + p.y * p.y;
  const x = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
  const y = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

/** Does point p lie on the curve somewhere other than at the curve's own end points? */
function touchesInterior(curve, p) {
  if (curve.kind === "line") {
    if (samePoint(p, curve.a) || samePoint(p, curve.b)) return false;
    const dx = curve.b.x - curve.a.x;
    const dy = curve.b.y - curve.a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 < 1e-18) return false;
    const t = ((p.x - curve.a.x) * dx + (p.y - curve.a.y) * dy) / length2;
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(curve.a.x + t * dx - p.x, curve.a.y + t * dy - p.y) < EPS;
  }
  if (curve.kind === "arc") {
    if (samePoint(p, curve.a) || samePoint(p, curve.b)) return false;
    if (samePoint(p, curve.m)) return true;
    const circle = circleThrough(curve.a, curve.m, curve.b);
    if (!circle || Math.abs(Math.hypot(p.x - circle.x, p.y - circle.y) - circle.r) > EPS) return false;
    // on the arc's side: p and m on the same side of chord a-b
    const side = q => (curve.b.x - curve.a.x) * (q.y - curve.a.y) - (curve.b.y - curve.a.y) * (q.x - curve.a.x);
    return side(p) * side(curve.m) > 0;
  }
  if (curve.kind === "spline") {
    return curve.points.slice(1, -1).some(point => samePoint(point, p));
  }
  if (curve.kind === "circle") {
    return Math.abs(Math.hypot(p.x - curve.center.x, p.y - curve.center.y) - curve.radius) < EPS;
  }
  return false;
}

/** Every evaluable point of a sketch (for extent checks): curve ends, arc mids, spline points, circle extremes. */
function sketchPoints(calls, sketchVar, env) {
  const points = [];
  for (const call of calls.filter(c => c.sketch === sketchVar)) {
    if (call.fn === "skLineSegment" || call.fn === "skArc") {
      for (const key of ["start", "mid", "end"]) {
        const point = evaluatePoint(mapEntry(call.map, key) || "", env);
        if (point) points.push(point);
      }
    } else if (call.fn === "skFitSpline") {
      const list = mapEntry(call.map, "points");
      if (list?.startsWith("[")) for (const text of splitTopLevel(list.slice(1, -1))) { const point = evaluatePoint(text, env); if (point) points.push(point); }
    } else if (call.fn === "skCircle") {
      const center = evaluatePoint(mapEntry(call.map, "center") || "", env);
      const radius = evaluate(mapEntry(call.map, "radius") || "", env);
      if (center && radius !== null) points.push({ x: center.x - radius, y: center.y }, { x: center.x + radius, y: center.y }, { x: center.x, y: center.y - radius }, { x: center.x, y: center.y + radius });
    } else if (call.fn === "skRectangle") {
      for (const key of ["firstCorner", "secondCorner"]) {
        const point = evaluatePoint(mapEntry(call.map, key) || "", env);
        if (point) points.push(point);
      }
    }
  }
  return points;
}

/**
 * Revolve profiles must stay on one side of the axis, otherwise Onshape reports
 * "Revolve would create self-intersecting part" (headphones band drawn from -W/2 to +W/2
 * and revolved about x = 0). Handles axes along the base plane's sketch Y or X axis.
 */
function revolveCrossings(code) {
  const env = buildEnv(code);
  const base = basePlaneVar(code);
  const calls = sketchCalls(code);
  const sketchOf = {};
  for (const match of code.matchAll(/\bvar\s+(\w+)\s*=\s*newSketchOnPlane\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{\s*"sketchPlane"\s*:\s*(\w+)\s*\}/g)) {
    sketchOf[match[2]] = { sketchVar: match[1], planeVar: match[3] };
  }
  const lineVars = Object.fromEntries([...code.matchAll(/\bvar\s+(\w+)\s*=\s*(line\s*\([^;]+\))\s*;/g)].map(m => [m[1], m[2]]));
  const b = base.replace(/[$]/g, "\\$");
  const yAxis = new RegExp(`^line\\(\\s*${b}\\.origin\\s*,\\s*-?\\s*cross\\(\\s*${b}\\.normal\\s*,\\s*${b}\\.x\\s*\\)\\s*\\)$`);
  const xAxis = new RegExp(`^line\\(\\s*${b}\\.origin\\s*,\\s*-?\\s*${b}\\.x\\s*\\)$`);
  const results = [];
  for (const match of code.matchAll(/\bopRevolve\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{([\s\S]*?)\}\s*\)\s*;/g)) {
    const sketchId = (match[2].match(/"entities"\s*:\s*qSketchRegion\s*\(\s*id\s*\+\s*"(\w+)"/) || [])[1];
    let axis = (match[2].match(/"axis"\s*:\s*(line\s*\([^\n]*?\)\s*\)|line\s*\([^\n]*?\)|\w+)\s*,?\s*\n/) || [])[1];
    if (!sketchId || !axis) continue;
    axis = (lineVars[axis.trim()] || axis).replace(/\s+/g, " ").trim();
    const sketch = sketchOf[sketchId];
    if (!sketch || sketch.planeVar !== base) continue;
    const coordinate = yAxis.test(axis) ? "x" : xAxis.test(axis) ? "y" : null;
    if (!coordinate) continue;
    const values = sketchPoints(calls, sketch.sketchVar, env).map(point => point[coordinate]);
    if (!values.length) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const scale = Math.max(1, max - min);
    if (min < -1e-6 * scale && max > 1e-6 * scale) results.push({ revolveId: match[1], sketchId, coordinate, min, max, at: match.index });
  }
  return results;
}

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
    const curves = []; // geometry to test "does this end touch another curve's interior?"
    let skip = false;
    for (const call of mine) {
      if (mapEntry(call.map, "construction") === "true") continue;
      if (call.fn === "skLineSegment" || call.fn === "skArc") {
        const a = evaluatePoint(mapEntry(call.map, "start") || "", env);
        const b = evaluatePoint(mapEntry(call.map, "end") || "", env);
        if (!a || !b) { skip = true; break; }
        ends.push(a, b);
        if (call.fn === "skLineSegment") curves.push({ kind: "line", a, b });
        else {
          const m = evaluatePoint(mapEntry(call.map, "mid") || "", env);
          if (m) curves.push({ kind: "arc", a, m, b });
        }
      } else if (call.fn === "skFitSpline") {
        const points = mapEntry(call.map, "points");
        if (!points || !points.startsWith("[")) { skip = true; break; }
        const list = splitTopLevel(points.slice(1, -1)).filter(Boolean).map(text => evaluatePoint(text, env));
        if (!list.length || list.some(point => !point)) { skip = true; break; }
        const first = list[0];
        const last = list[list.length - 1];
        if (pointKey(first) !== pointKey(last)) ends.push(first, last); // closed splines add nothing
        curves.push({ kind: "spline", points: list });
      } else if (call.fn === "skCircle") {
        const center = evaluatePoint(mapEntry(call.map, "center") || "", env);
        const radius = evaluate(mapEntry(call.map, "radius") || "", env);
        if (center && radius !== null) curves.push({ kind: "circle", center, radius });
      } else if (!["skRectangle", "skRegularPolygon", "skEllipse", "skSolve", "skPolyline", "skConstraint"].includes(call.fn)) {
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
    // An end is dangling only if NO other curve meets it: degree 1, and it does not land
    // on another curve's interior (a T-junction such as an axis line ending on the middle
    // of an arc is connected). Junctions of 3+ ends are connected too.
    const dangling = [...counts.values()]
      .filter(entry => entry.count === 1 && !curves.some(curve => touchesInterior(curve, entry.point)))
      .map(entry => entry.point);
    if (dangling.length) {
      const solve = code.indexOf(`skSolve(${sketchVar})`, mine[mine.length - 1].end);
      results.push({ sketchVar, sketchId, dangling, solveAt: solve });
    }
  }
  return results;
}

/**
 * Sweeps: the profile must face along the path where the path starts (a coin threaded
 * on a wire). Works in the base sketch plane's frame (x, y = cross(normal, x), normal),
 * for paths drawn on that plane and profile planes whose normal is one of its axes.
 * Returns [{ planeVar, normalText, fixText, dot, at }] for misaligned sweeps.
 */
/** The feature's base plane variable (`var skPlane = isQueryEmpty(context, definition.location) ? ...`). */
function basePlaneVar(code) {
  return (code.match(/\bvar\s+(\w+)\s*=\s*isQueryEmpty\s*\(\s*context\s*,\s*definition\.\w+\s*\)/) || [])[1] || "skPlane";
}

function axisPatterns(base) {
  const b = base.replace(/[$]/g, "\\$");
  return [
    [new RegExp(`^${b}\\.x$`), [1, 0, 0]],
    [new RegExp(`^-\\s*${b}\\.x$`), [-1, 0, 0]],
    [new RegExp(`^${b}\\.normal$`), [0, 0, 1]],
    [new RegExp(`^-\\s*${b}\\.normal$`), [0, 0, -1]],
    [new RegExp(`^cross\\(\\s*${b}\\.normal\\s*,\\s*${b}\\.x\\s*\\)$`), [0, 1, 0]],
    [new RegExp(`^-\\s*cross\\(\\s*${b}\\.normal\\s*,\\s*${b}\\.x\\s*\\)$`), [0, -1, 0]],
  ];
}

function axisOf(expression, aliases, base) {
  let text = String(expression || "").trim();
  if (aliases[text]) text = aliases[text];
  for (const [pattern, vector] of axisPatterns(base)) if (pattern.test(text)) return vector;
  return null;
}

function analyseSweeps(code) {
  const env = buildEnv(code);
  const base = basePlaneVar(code);
  const results = [];
  const sketchPlaneOf = {};
  for (const match of code.matchAll(/\bvar\s+(\w+)\s*=\s*newSketchOnPlane\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{\s*"sketchPlane"\s*:\s*(\w+)\s*\}/g)) {
    sketchPlaneOf[match[2]] = { sketchVar: match[1], planeVar: match[3] };
  }
  // var skY = cross(skPlane.normal, skPlane.x); style aliases for axis expressions
  const aliasPattern = new RegExp(String.raw`\bvar\s+(\w+)\s*=\s*(-?\s*(?:cross\(\s*${base}\.normal\s*,\s*${base}\.x\s*\)|${base}\.(?:x|normal)))\s*;`, "g");
  const aliases = Object.fromEntries([...code.matchAll(aliasPattern)].map(m => [m[1], m[2]]));
  const planes = {};
  for (const match of code.matchAll(/\bvar\s+(\w+)\s*=\s*plane\s*\(([^;]+)\)\s*;/g)) {
    const args = splitTopLevel(match[2]);
    if (args.length === 2) planes[match[1]] = { origin: args[0], normal: args[1], at: match.index, text: match[0] };
  }
  const calls = sketchCalls(code);
  for (const match of code.matchAll(/\bopSweep\s*\(\s*context\s*,\s*id\s*\+\s*"\w+"\s*,\s*\{([\s\S]*?)\}\s*\)\s*;/g)) {
    const profileId = (match[1].match(/"profiles"\s*:\s*qSketchRegion\s*\(\s*id\s*\+\s*"(\w+)"/) || [])[1];
    const pathId = (match[1].match(/"path"\s*:\s*qCreatedBy\s*\(\s*id\s*\+\s*"(\w+)"/) || [])[1];
    const profile = sketchPlaneOf[profileId];
    const path = sketchPlaneOf[pathId];
    if (!profile || !path || path.planeVar !== base || !planes[profile.planeVar]) continue;
    const plane = planes[profile.planeVar];
    const normal = axisOf(plane.normal, aliases, base);
    if (!normal) continue;
    const first = calls.find(call => call.sketch === path.sketchVar && ["skFitSpline", "skLineSegment", "skArc"].includes(call.fn));
    if (!first) continue;
    let p0;
    let p1;
    if (first.fn === "skFitSpline") {
      const list = splitTopLevel((mapEntry(first.map, "points") || "").slice(1, -1)).filter(Boolean);
      p0 = evaluatePoint(list[0] || "", env);
      p1 = evaluatePoint(list[1] || "", env);
    } else {
      p0 = evaluatePoint(mapEntry(first.map, "start") || "", env);
      p1 = evaluatePoint(mapEntry(first.map, first.fn === "skArc" ? "mid" : "end") || "", env);
    }
    if (!p0 || !p1) continue;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const tangent = [dx / length, dy / length, 0];
    const dot = Math.abs(tangent[0] * normal[0] + tangent[1] * normal[1]);
    if (dot >= 0.5) continue;
    let fixText = null;
    if (Math.abs(tangent[0]) > 0.9) fixText = tangent[0] > 0 ? `${base}.x` : `-${base}.x`;
    else if (Math.abs(tangent[1]) > 0.9) fixText = tangent[1] > 0 ? `cross(${base}.normal, ${base}.x)` : `-cross(${base}.normal, ${base}.x)`;
    results.push({ planeVar: profile.planeVar, plane, fixText, dot, at: match.index, tangent });
  }
  return results;
}

/** Point misaligned sweep profiles along the path's start direction (axis-aligned starts only). */
export function autoAlignSweepProfiles(code) {
  let text = String(code || "");
  const fixed = [];
  for (const sweep of analyseSweeps(text).filter(s => s.fixText).sort((a, b) => b.plane.at - a.plane.at)) {
    const replacement = sweep.plane.text.replace(/,\s*([^,]+?)\s*\)\s*;\s*$/, `, ${sweep.fixText});`);
    if (replacement === sweep.plane.text) continue;
    text = text.slice(0, sweep.plane.at) + replacement + text.slice(sweep.plane.at + sweep.plane.text.length);
    fixed.push(sweep.planeVar);
  }
  return { code: text, fixed };
}

/** Ids created by operations (op*(context, id + "x")) and sketches. */
function createdIds(code) {
  const ids = new Set();
  // Any call taking (context, id + "x") creates something under that id: op*, sketches,
  // std features (extrude, fillet, ...), and helper functions defined in the file.
  for (const match of code.matchAll(/\b\w+\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)) ids.add(match[1]);
  return ids;
}

/**
 * Rewrite `var bodyId = id + "revolve";` aliases so later `qCapEntity(bodyId, ...)` and
 * `qCreatedBy(bodyId, ...)` read as `id + "revolve"`; the checks below match that form.
 */
function inlineIdAliases(code) {
  let text = code;
  for (const match of code.matchAll(/\bvar\s+(\w+)\s*=\s*id\s*\+\s*"(\w+)"\s*;/g)) {
    text = text.replace(new RegExp(String.raw`\b(qCreatedBy|qSketchRegion|qCapEntity|newSketchOnPlane|op[A-Z]\w*)\s*\(\s*(context\s*,\s*)?${match[1]}\b`, "g"), `$1($2id + "${match[2]}"`);
  }
  return text;
}

/** Issues in the validator's shape: { line, message, text }. */
// Revolves whose axis direction is the profile sketch plane's normal. Onshape: "Revolved face is
// perpendicular to axis" (a "Simple Cone" sketched on Top and revolved about Top's normal).
function revolveAxesAlongNormal(text) {
  const sketchPlane = {};
  for (const m of text.matchAll(/\bnewSketchOnPlane\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{\s*"sketchPlane"\s*:\s*(\w+)\s*\}/g)) sketchPlane[m[1]] = m[2];
  const lineVars = Object.fromEntries([...text.matchAll(/\bvar\s+(\w+)\s*=\s*(line\s*\([^;]+\))\s*;/g)].map(m => [m[1], { expr: m[2], at: m.index }]));
  const found = [];
  for (const m of text.matchAll(/\bopRevolve\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{([\s\S]*?)\}\s*\)\s*;/g)) {
    const sketchId = (m[2].match(/"entities"\s*:\s*qSketchRegion\s*\(\s*id\s*\+\s*"(\w+)"/) || [])[1];
    const planeVar = sketchPlane[sketchId];
    if (!planeVar) continue;
    const axisRaw = ((m[2].match(/"axis"\s*:\s*([^\n]+?)\s*,?\s*(\n|$)/) || [])[1] || "").trim();
    const axisExpr = lineVars[axisRaw]?.expr || axisRaw;
    const direction = (axisExpr.match(/^line\s*\(\s*[^,]+?\s*,\s*(.+)\)\s*$/) || [])[1];
    if (!direction) continue;
    const normal = new RegExp(`^-?\\s*${planeVar}\\.normal(\\s*\\*\\s*-?[\\w.]+)?$`);
    if (normal.test(direction.trim())) {
      found.push({ revolveId: m[1], sketchId, planeVar, direction: direction.trim(), at: m.index, axisVar: lineVars[axisRaw] ? axisRaw : null });
    }
  }
  return found;
}

/** Rewrites a revolve axis that points along the sketch normal to the sketch's own y axis. */
export function autoFixRevolveAxisAlongNormal(code) {
  let text = String(code || "");
  for (const bad of revolveAxesAlongNormal(text).reverse()) {
    const inPlane = `cross(${bad.planeVar}.normal, ${bad.planeVar}.x)`;
    if (bad.axisVar) {
      text = text.replace(new RegExp(`(\\bvar\\s+${bad.axisVar}\\s*=\\s*line\\s*\\([^,;]+?,\\s*)${escapeRegExp(bad.direction)}(\\s*\\))`), `$1${inPlane}$2`);
    } else {
      const head = text.slice(0, bad.at);
      const tail = text.slice(bad.at).replace(new RegExp(`("axis"\\s*:\\s*line\\s*\\([^,\\n]+?,\\s*)${escapeRegExp(bad.direction)}(\\s*\\))`), `$1${inPlane}$2`);
      text = head + tail;
    }
  }
  return text;
}

// Runtime type mistakes that compile but fail when Onshape runs the feature (found by
// building live-site output in the Onshape-library simulator, 2026-11):
//   plane.y                        Plane has no y field  -> cross(plane.normal, plane.x)
//   rotationAround(axis, 2*PI/n)   angle without units   -> autoAngle(..., radian|degree)
//   "angleForward" : 2 * PI        same, in opRevolve
//   vector(lenA, lenB) * inch      length * inch = area  -> vector(lenA, lenB)
export function autoFixRuntimeTypes(code) {
  let text = String(code || "");
  const changes = [];

  // 1) plane.y -> cross(plane.normal, plane.x) for identifiers used as planes (.normal) or
  //    assigned from plane(...) / evPlane(...).
  const planeVars = new Set([
    ...[...text.matchAll(/\b([A-Za-z_]\w*)\.normal\b/g)].map(m => m[1]),
    ...[...text.matchAll(/\bvar\s+(\w+)\s*=\s*(?:plane|evPlane)\s*\(/g)].map(m => m[1]),
    ...[...text.matchAll(/"sketchPlane"\s*:\s*(\w+)/g)].map(m => m[1]),
  ]);
  for (const name of planeVars) {
    const pattern = new RegExp(`\\b${name}\\.y\\b`, "g");
    if (pattern.test(text)) {
      text = text.replace(pattern, `cross(${name}.normal, ${name}.x)`);
      changes.push(`${name}.y -> cross(${name}.normal, ${name}.x)`);
    }
  }

  // 1b) vector.x / .y / .z -> v[0] / v[1] / v[2] ("Vector has no field 'x'"): FeatureScript
  //     vectors are indexed; only a Plane has a field x. Only names that are certainly vectors
  //     are touched (a map with an "x" key is read the same way and must stay as written).
  const vectorVars = new Set();
  const vectorLists = new Set();
  const VECTOR_EXPR = /^\(?\s*(?:vector|normalize|cross|evVertexPoint|planeToWorld|toWorld)\s*\(|^[A-Za-z_]\w*\.(?:origin|normal|direction)\b/;
  for (const m of text.matchAll(/\b(?:var|const)\s+(\w+)\s*=\s*([^;]+);/g)) {
    const expr = m[2].trim();
    if (/^\[\s*vector\s*\(/.test(expr)) vectorLists.add(m[1]);
    else if (VECTOR_EXPR.test(expr)) vectorVars.add(m[1]);
  }
  for (const m of text.matchAll(/\bfor\s*\(\s*var\s+(\w+)\s+in\s+(?:(\[\s*vector\s*\()|([A-Za-z_]\w*)\s*\))/g)) {
    if (m[2] || vectorLists.has(m[3])) vectorVars.add(m[1]);
  }
  const AXIS = { x: 0, y: 1, z: 2 };
  let indexed = 0;
  // Beyond the certain vectors: in FeatureScript only a Plane has a field "x" and nothing has
  // "y" or "z", so any other name read that way is a vector (pos = positions[i]; pos.x), unless
  // it is a map: built from a { } literal, looped over a list of maps, or read with other fields.
  const mapVars = new Set([
    ...[...text.matchAll(/\b(?:var|const)\s+(\w+)\s*=\s*\{/g)].map(m => m[1]),
    ...[...text.matchAll(/\bfor\s*\(\s*var\s+(\w+)\s+in\s+\[\s*\{/g)].map(m => m[1]),
    ...[...text.matchAll(/\b(\w+)\s+is\s+map\b/g)].map(m => m[1]),
  ]);
  const otherFields = new Set([...text.matchAll(/\b([A-Za-z_]\w*)\.(?![xyz]\b)[A-Za-z_]\w*/g)].map(m => m[1]));
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)(?:\[[^\]\n]*\])?\.[xyz]\b(?!\s*\()/g)) {
    const name = m[1];
    if (!mapVars.has(name) && !otherFields.has(name)) vectorVars.add(name);
  }
  for (const name of vectorVars) {
    if (planeVars.has(name) || /plane/i.test(name) || /^(definition|context|id)$/.test(name) || mapVars.has(name)) continue;
    text = text.replace(new RegExp(`\\b${name}(\\[[^\\]\\n]*\\])?\\.([xyz])\\b(?!\\s*\\()`, "g"), (whole, index, axis) => {
      indexed += 1;
      return `${name}${index || ""}[${AXIS[axis]}]`;
    });
  }
  // plane.origin.x and friends: origin, normal and direction are vectors.
  text = text.replace(/\.(origin|normal|direction)\.([xyz])\b(?!\s*\()/g, (whole, field, axis) => {
    indexed += 1;
    return `.${field}[${AXIS[axis]}]`;
  });
  if (indexed) changes.push(`${indexed} vector .x/.y/.z field read(s) rewritten to [0]/[1]/[2]`);

  // 1b2) A sketch's regions are qSketchRegion(sketchId); qCreatedBy(sketchId, EntityType.FACE)
  //      as a loft/extrude profile selected no faces ("opLoft: a profile query selects no faces").
  const sketchIds = new Set([...text.matchAll(/\bnewSketch(?:OnPlane)?\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)].map(m => m[1]));
  let regions = 0;
  text = text.replace(/\bqCreatedBy\s*\(\s*id\s*\+\s*"(\w+)"\s*,\s*EntityType\.FACE\s*\)/g, (whole, name) => {
    if (!sketchIds.has(name)) return whole;
    regions += 1;
    return `qSketchRegion(id + "${name}")`;
  });
  if (regions) changes.push(`${regions} sketch face query(s) rewritten to qSketchRegion`);

  // 1b3) line(vector(0, 0, 0), dir): a line's origin is a point with units ("line origin must
  //      be a 3D length vector"). Plain-number origins get * inch.
  let lineOrigins = 0;
  text = rewriteCallArgs(text, "line", args => {
    if (args.length !== 2) return null;
    const origin = args[0].trim();
    const plain = origin.match(/^vector\s*\(([^()]*)\)$/);
    if (!plain || !plain[1].split(",").every(part => /^\s*-?\d*\.?\d+\s*$/.test(part))) return null;
    lineOrigins += 1;
    return [`${origin} * inch`, args[1].trim()];
  });
  if (lineOrigins) changes.push(`${lineOrigins} unitless line origin(s) given inches`);

  // 1b4) fCylinder(context, id, bottom, top, radius) with positional arguments: the primitive
  //      takes a map.
  let cylinders = 0;
  text = rewriteCallArgs(text, "fCylinder", args => {
    if (args.length !== 5 || /^\s*\{/.test(args[2])) return null;
    cylinders += 1;
    return [args[0].trim(), args[1].trim(), `{ "bottomCenter" : ${args[2].trim()}, "topCenter" : ${args[3].trim()}, "radius" : ${args[4].trim()} }`];
  });
  if (cylinders) changes.push(`${cylinders} positional fCylinder call(s) rewritten to a map`);

  // 1b5) concatenate(a, b) does not exist ("Cannot resolve identifier concatenate"); arrays
  //      join with concatenateArrays([a, b]).
  if (/\bconcatenate\s*\(/.test(text) && !/\bfunction\s+concatenate\s*\(/.test(text)) {
    text = rewriteCallArgs(text, "concatenate", args => [`[${args.map(arg => arg.trim()).join(", ")}]`]);
    text = text.replace(/\bconcatenate\s*\(/g, "concatenateArrays(");
    changes.push("concatenate(...) rewritten to concatenateArrays([...])");
  }

  // 1c) id + "rib" ~ i is (id + "rib") ~ i, an Id joined to a number ("cannot concatenate
  //     Id with '~'"): the name has to be built first, id + ("rib" ~ i).
  let idJoins = 0;
  text = text.replace(/\bid\s*\+\s*("(?:[^"\\\n]|\\.)*"(?:\s*~\s*(?:"(?:[^"\\\n]|\\.)*"|[A-Za-z_][\w.]*(?:\[[^\]]*\])?|\d+|\([^()]*\)))+)/g, (whole, joined) => {
    idJoins += 1;
    return `id + (${joined})`;
  });
  if (idJoins) changes.push(`${idJoins} id + "name" ~ n rewritten to id + ("name" ~ n)`);

  // 2) Unitless angles. Find each variable's defining expression to judge its units.
  const varExpr = {};
  for (const m of text.matchAll(/\b(?:var|const)\s+(\w+)\s*=\s*([^;]+);/g)) varExpr[m[1]] = m[2];
  const hasUnit = expr => /\b(radian|degree)\b/.test(expr);
  const unitFor = expr => (/\b(360|180)\b/.test(expr) && !/\bPI\b/.test(expr) ? "degree" : "radian");
  const resolve = expr => {
    let full = expr;
    for (let depth = 0; depth < 3; depth += 1) {
      full = full.replace(/\b([A-Za-z_]\w*)\b/g, name => (varExpr[name] && !/^(PI|i|j|k)$/.test(name) ? `(${varExpr[name]})` : name));
    }
    return full;
  };
  let wrapped = 0;
  const needsUnit = angle => {
    const full = resolve(angle);
    return !hasUnit(full) && !/autoAngle\(/.test(angle) && /[\dA-Za-z]/.test(angle) ? unitFor(full) : null;
  };
  text = rewriteCallArgs(text, "rotationAround", args => {
    if (args.length !== 2) return null;
    const unit = needsUnit(args[1]);
    if (!unit) return null;
    wrapped += 1;
    return [args[0].trim(), `autoAngle(${args[1].trim()}, ${unit})`];
  });
  text = text.replace(/("angle(?:Forward|Back)"\s*:\s*)([^,\n}]+)/g, (entry, key, angle) => {
    const full = resolve(angle);
    if (hasUnit(full) || /autoAngle\(/.test(angle)) return entry;
    wrapped += 1;
    return `${key}autoAngle(${angle.trim()}, ${unitFor(full)})`;
  });
  // sin/cos/tan need an angle: sin(2 * PI * i / n) -> sin(autoAngle(..., radian)).
  for (const fn of ["sin", "cos", "tan"]) {
    text = rewriteCallArgs(text, fn, args => {
      if (args.length !== 1 || !args[0].trim()) return null;
      const unit = needsUnit(args[0]);
      if (!unit) return null;
      wrapped += 1;
      return [`autoAngle(${args[0].trim()}, ${unit})`];
    });
  }
  if (wrapped) {
    changes.push(`${wrapped} unitless angle(s) given units`);
    text = ensureHelper(text, "autoAngle", "// A plain number used as an angle gets the unit the expression implies; angles pass through.\nfunction autoAngle(value, unit)\n{\n    return value is number ? value * unit : value;\n}");
  }

  // Directions must be unitless: hingeAxis = vector(1, 0, 0) * inch used as a plane normal or an
  // extrude direction fails ("Failed to extrude", "plane normal must be a unitless vector").
  // Wrap such vectors in normalize(), which keeps the direction and drops the units.
  const unitVectorVars = new Set(Object.entries(varExpr)
    .filter(([, expr]) => /^\s*vector\s*\([^()]*\)\s*\*\s*(inch|millimeter|centimeter|meter)\s*$/.test(expr))
    .map(([name]) => name));
  const isUnitVector = arg => {
    const a = arg.trim();
    return unitVectorVars.has(a) || /^vector\s*\([^()]*\)\s*\*\s*(inch|millimeter|centimeter|meter)$/.test(a);
  };
  let directions = 0;
  const unitless = arg => { directions += 1; return `normalize(${arg.trim()})`; };
  text = rewriteCallArgs(text, "plane", args => {
    if (args.length < 2 || !args.slice(1).some(isUnitVector)) return null;
    return args.map((arg, k) => (k > 0 && isUnitVector(arg) ? unitless(arg) : arg.trim()));
  });
  text = rewriteCallArgs(text, "line", args => (args.length === 2 && isUnitVector(args[1]) ? [args[0].trim(), unitless(args[1])] : null));
  text = text.replace(/("direction"\s*:\s*)([A-Za-z_]\w*|vector\s*\([^()]*\)\s*\*\s*(?:inch|millimeter|centimeter|meter))(\s*[,\n}])/g, (whole, key, arg, tail) =>
    (isUnitVector(arg) ? `${key}${unitless(arg)}${tail}` : whole));
  if (directions) changes.push(`${directions} direction vector(s) with length units normalized`);

  // JavaScript array habit: arr.push(x); -> arr = append(arr, x); (.length is fixed in ai.js)
  let pushes = 0;
  text = text.replace(/^(\s*)([A-Za-z_]\w*)\.push\s*\(([^;]*)\)\s*;/gm, (whole, indent, name, value) => {
    pushes += 1;
    return `${indent}${name} = append(${name}, ${value.trim()});`;
  });
  if (pushes) changes.push(`${pushes} JavaScript push() call(s) rewritten to append()`);

  // translation(...) does not exist in FeatureScript ("Variable translation not found");
  // transform(vector) is a translation. translation(x, y, z) -> transform(vector(x, y, z)).
  if (/\btranslation\s*\(/.test(text) && !/\bfunction\s+translation\s*\(/.test(text)) {
    text = rewriteCallArgs(text, "translation", args => (args.length >= 2 ? [`vector(${args.map(arg => arg.trim()).join(", ")})`] : null));
    text = text.replace(/\btranslation\s*\(/g, "transform(");
    changes.push("translation(...) rewritten to transform(vector)");
  }

  // "text" + number is not defined in FeatureScript (strings join with ~):
  // id + "spoke" + i -> id + ("spoke" ~ i).
  let joined = 0;
  text = text.replace(/("(?:[^"\\\n]|\\.)*")\s*\+\s*([A-Za-z_][\w.]*(?:\s*\[[^\]]*\])?|\d+|\([^()]*\))/g, (whole, literal, operand, offset) => {
    const before = text.slice(Math.max(0, offset - 40), offset);
    if (/\b(?:annotation|import)\b[^\n]*$/.test(before) || /"Name"\s*:\s*$/.test(before)) return whole;
    joined += 1;
    return `(${literal} ~ ${operand})`;
  });
  if (joined) changes.push(`${joined} "text" + value joined with ~`);

  // opPattern needs one instance name per transform: fill an empty or missing list.
  let named = 0;
  text = text.replace(/\bopPattern\s*\(\s*context\s*,[^{]*\{([^;]*?)\}\s*\)\s*;/g, (call, body) => {
    const transforms = (body.match(/"transforms"\s*:\s*([A-Za-z_]\w*)/) || [])[1];
    if (!transforms) return call;
    let next = body;
    if (/"instanceNames"\s*:\s*\[\s*\]/.test(body)) next = body.replace(/"instanceNames"\s*:\s*\[\s*\]/, `"instanceNames" : patternNames(size(${transforms}))`);
    else if (!/"instanceNames"/.test(body)) next = body.replace(/("transforms"\s*:\s*[A-Za-z_]\w*)/, `$1,\n            "instanceNames" : patternNames(size(${transforms}))`);
    if (next === body) return call;
    named += 1;
    return call.replace(body, next);
  });
  if (named) {
    changes.push(`${named} opPattern instance name list(s) filled`);
    text = ensureHelper(text, "patternNames", "// One unique instance name per pattern transform.\nfunction patternNames(count)\n{\n    var names = [];\n    for (var i = 0; i < count; i += 1)\n    {\n        names = append(names, \"p\" ~ i);\n    }\n    return names;\n}");
  }

  // 3) vector(a, b) * inch where every component is already a length (definition lengths or
  //    variables derived from them without "/ inch").
  const lengthParams = new Set([...text.matchAll(/\bisLength\s*\(\s*definition\.(\w+)/g)].map(m => m[1]));
  const isLengthExpr = (expr, seen = 0) => {
    const e = expr.trim();
    if (/\/\s*(inch|millimeter|meter|centimeter)\b/.test(e) || seen > 3) return false;
    if ([...e.matchAll(/\bdefinition\.(\w+)/g)].some(m => lengthParams.has(m[1]))) return true;
    // Any variable in the expression that holds a length makes the expression a length.
    return [...e.replace(/\bdefinition\.\w+/g, " ").matchAll(/\b([A-Za-z_]\w*)\b/g)]
      .some(m => varExpr[m[1]] && isLengthExpr(varExpr[m[1]], seen + 1));
  };
  // Component by component: vector(halfW + 1.5, 0.5) * inch -> vector(halfW + 1.5 * inch, 0.5 * inch).
  // Terms that are already lengths keep their units; plain-number terms get the unit.
  let unscaled = 0;
  const splitTerms = expr => {
    const terms = [];
    let depth = 0, start = 0;
    for (let i = 0; i < expr.length; i += 1) {
      const ch = expr[i];
      if (ch === "(" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "]") depth -= 1;
      else if ((ch === "+" || ch === "-") && depth === 0 && i > 0 && !/[*/(,+\-eE]\s*$/.test(expr.slice(0, i).trimEnd().slice(-1) || "(") && expr.slice(0, i).trim()) {
        terms.push(expr.slice(start, i));
        start = i;
      }
    }
    terms.push(expr.slice(start));
    return terms;
  };
  const hasLengthUnit = expr => /\b(inch|millimeter|meter|centimeter)\b/.test(expr);
  const scaleComponent = (component, unit) => {
    // "0 * inch" is a length already: multiplying it by the unit again would make an area.
    if (!isLengthExpr(component)) return { text: hasLengthUnit(component) ? component.trim() : `(${component.trim()}) * ${unit}`, mixed: false };
    let mixed = false;
    const out = splitTerms(component).map(term => {
      const sign = (term.match(/^\s*([+-])/) || [])[1] || "";
      const body = term.replace(/^\s*[+-]/, "").trim();
      if (!body || isLengthExpr(body) || /\b(inch|millimeter|meter|centimeter)\b/.test(body)) return term;
      mixed = true;
      return ` ${sign} ${body} * ${unit}`.replace(/^ {2}/, " ");
    }).join("");
    return { text: out.trim(), mixed };
  };
  // Arguments are found with balanced brackets, so max(a, min(b, c)) inside a vector works too.
  const rescaleVector = (inner, unit) => {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === "(" || inner[i] === "[") depth += 1;
      else if (inner[i] === ")" || inner[i] === "]") depth -= 1;
      else if (inner[i] === "," && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
    }
    parts.push(inner.slice(start));
    if (parts.length < 2 || !parts.some(part => isLengthExpr(part))) return null; // all plain numbers: correct as written
    return `vector(${parts.map(part => scaleComponent(part, unit).text).join(", ")})`;
  };
  {
    const finder = /\bvector\s*\(/g;
    let out = "";
    let last = 0;
    let match;
    while ((match = finder.exec(text))) {
      const open = match.index + match[0].length - 1;
      const close = matchingClose(text, open);
      if (close < 0) continue;
      const unit = text.slice(close + 1).match(/^\s*\*\s*(inch|millimeter|centimeter|meter)\b/);
      if (!unit) continue;
      const rewritten = rescaleVector(text.slice(open + 1, close), unit[1]);
      if (!rewritten) continue;
      unscaled += 1;
      out += text.slice(last, match.index) + rewritten;
      last = close + 1 + unit[0].length;
      finder.lastIndex = last;
    }
    if (last) text = out + text.slice(last);
  }
  if (unscaled) changes.push(`${unscaled} vector(...) * unit with length components fixed`);
  return { code: text, changes };
}

// True when the body made by operation `opId` is cut away from something: it is a "tools"
// entry of a SUBTRACTION or INTERSECTION opBoolean, or one of kitCut's cutters.
function usedAsCutter(text, opId) {
  const ref = new RegExp(`id\\s*\\+\\s*"${opId}"`);
  for (const call of text.matchAll(/\bopBoolean\s*\(\s*context\s*,[^{]*\{([^;]*?)\}\s*\)\s*;/g)) {
    const body = call[1];
    if (!/BooleanOperationType\.(SUBTRACTION|INTERSECTION)\b/.test(body)) continue;
    const tools = body.match(/"tools"\s*:\s*([\s\S]*?)(?:,\s*"\w+"\s*:|$)/);
    if (tools && ref.test(tools[1])) return true;
  }
  for (const call of text.matchAll(/\bkitCut\s*\(\s*context\s*,[^;]*?\[([^\]]*)\]\s*\)\s*;/g)) {
    if (ref.test(call[1])) return true;
  }
  return false;
}

/**
 * Holes drawn in the same sketch as the outline: qSketchRegion(id + "sk") selects every
 * region, the holes included, so a single extrude fills them back in (a brake disc came out
 * as a plain disc). With filterInnerLoops = true the inner loops stay open. Applied only when
 * the sketch holds several closed shapes and exactly one operation uses its regions.
 */
export function autoFilterInnerLoops(code) {
  let text = String(code || "");
  const sketchVar = {};
  for (const m of text.matchAll(/\bvar\s+(\w+)\s*=\s*newSketch(?:OnPlane)?\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)) sketchVar[m[2]] = m[1];
  const fixed = [];
  for (const [sketchId, variable] of Object.entries(sketchVar)) {
    const uses = [...text.matchAll(new RegExp(`qSketchRegion\\s*\\(\\s*id\\s*\\+\\s*"${sketchId}"\\s*(,[^)]*)?\\)`, "g"))];
    if (uses.length !== 1 || uses[0][1]) continue; // used twice, or the flag is already given
    const count = pattern => (text.match(new RegExp(`\\b(?:${pattern})\\s*\\(\\s*${variable}\\s*,`, "g")) || []).length;
    const closed = count("skCircle|skRectangle|skRegularPolygon|skEllipse");
    const open = count("skLineSegment|skArc|skFitSpline");
    if (!(closed >= 2 || (closed >= 1 && open >= 3))) continue;
    // A sketch of hole cutters (its body is the tool of a later cut) is left alone. A body
    // that is only joined onto another one (a UNION tool) is a real piece and keeps its holes:
    // a flange whose plate was unioned with its hub came out as a plain disc.
    const ops = [...text.slice(0, uses[0].index).matchAll(/\bop\w+\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"/g)];
    const opId = ops.length ? ops[ops.length - 1][1] : null;
    if (opId && usedAsCutter(text, opId)) continue;
    text = text.replace(uses[0][0], `qSketchRegion(id + "${sketchId}", true)`);
    fixed.push(sketchId);
  }
  return { code: text, fixed };
}

/**
 * A parameter used in the feature body but missing from the dialog (definition.holeDepth
 * with no isLength line) is a compile error in Onshape. Declare it with a sensible type and
 * default instead of spending an AI attempt on it.
 */
export function autoDeclareMissingParams(code) {
  const text = String(code || "");
  const head = text.match(/\bprecondition\s*\{/);
  if (!head) return { code: text, declared: [] };
  const open = head.index + head[0].length - 1;
  const close = matchingClose(text, open);
  if (close < 0) return { code: text, declared: [] };
  const precondition = text.slice(open, close);
  const body = text.slice(close);
  const declared = new Set([...precondition.matchAll(/definition\.(\w+)/g)].map(m => m[1]));
  const missing = [...new Set([...body.matchAll(/\bdefinition\.(\w+)/g)].map(m => m[1]))].filter(name => !declared.has(name));
  if (!missing.length) return { code: text, declared: [] };
  const indent = (precondition.match(/\n([ \t]+)\S/) || [null, "        "])[1];
  const label = name => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
  const lines = missing.map(name => {
    const usedAsFlag = new RegExp(`(if\\s*\\(\\s*!?\\s*definition\\.${name}\\s*[)&|]|definition\\.${name}\\s*\\?|!definition\\.${name}\\b)`).test(body);
    const annotation = `${indent}annotation { "Name" : "${label(name)}" }\n${indent}`;
    if (usedAsFlag || /^(is|has|add|include|show|enable|use|with)[A-Z]/.test(name)) return `${annotation}definition.${name} is boolean;`;
    if (/(count|number|num|teeth|sides|spokes|quantity|qty|holes|slots|fins|ribs|blades|segments|instances)$/i.test(name) || /^(num|number|count)/i.test(name)) {
      return `${annotation}isInteger(definition.${name}, { (unitless) : [1, 4, 200] } as IntegerBoundSpec);`;
    }
    if (/angle/i.test(name)) return `${annotation}isAngle(definition.${name}, { (degree) : [0, 30, 360] } as AngleBoundSpec);`;
    const size = /(thick|wall|fillet|chamfer|gap|clearance|offset|inset|margin)/i.test(name) ? 0.1 : /radius/i.test(name) ? 0.25 : 0.5;
    return `${annotation}isLength(definition.${name}, { (inch) : [0.001, ${size}, 500] } as LengthBoundSpec);`;
  });
  const lineStart = text.lastIndexOf("\n", close - 1) + 1; // the precondition's closing brace line
  return { code: `${text.slice(0, lineStart)}${lines.join("\n")}\n${text.slice(lineStart)}`, declared: missing };
}

/**
 * A selection parameter needs a "Filter" (Onshape: "Missing filter and no ALWAYS_HIDDEN UI
 * hint"). The plane picker gets the plane filter; any other selection gets a face filter.
 */
export function autoFixQueryFilters(code) {
  let fixed = 0;
  const text = String(code || "").replace(/annotation\s*\{([^{}]*)\}(\s*definition\.(\w+)\s+is\s+Query\s*;)/g, (whole, inner, rest, name) => {
    if (/"Filter"\s*:|ALWAYS_HIDDEN/.test(inner)) return whole;
    fixed += 1;
    const filter = /location|plane/i.test(name) || /plane/i.test(inner)
      ? '"Filter" : GeometryType.PLANE, "MaxNumberOfPicks" : 1'
      : '"Filter" : EntityType.FACE';
    return `annotation {${inner.replace(/\s*$/, "")}, ${filter} }${rest}`;
  });
  return { code: text, fixed };
}

// Rewrites the arguments of every call to `name(...)`, with balanced brackets and strings
// (axes like line(vector(0, 0, 0) * inch, vector(0, 0, 1)) contain nested commas).
// rewrite(args) returns the new argument list, or null to keep the call as it is.
function rewriteCallArgs(text, name, rewrite) {
  const head = new RegExp(`\\b${name}\\s*\\(`, "g");
  let out = "";
  let last = 0;
  let match;
  while ((match = head.exec(text))) {
    const open = match.index + match[0].length - 1;
    let depth = 0, close = -1, inString = false;
    const commas = [];
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) { if (ch === "\\") i += 1; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) { depth -= 1; if (depth === 0) { close = i; break; } }
      else if (ch === "," && depth === 1) commas.push(i);
    }
    if (close < 0) break;
    const bounds = [open, ...commas, close];
    const args = bounds.slice(0, -1).map((at, k) => text.slice(at + 1, bounds[k + 1]));
    const next = rewrite(args);
    if (next) {
      out += text.slice(last, open + 1) + next.join(", ") + ")";
      last = close + 1;
    }
    head.lastIndex = open + 1;
  }
  return out + text.slice(last);
}

// Top-level helper functions go right after the import line (the end of the file is touched
// by other repairs that close a truncated feature).
function ensureHelper(text, name, source) {
  if (new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(text)) return text;
  const importMatch = text.match(/^import\s*\([^)]*\)\s*;[ \t]*\r?\n/m);
  if (!importMatch) return `${text.trimEnd()}\n\n${source}\n`;
  const at = importMatch.index + importMatch[0].length;
  return `${text.slice(0, at)}\n${source}\n${text.slice(at)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkFeatureScriptGeometry(code) {
  const text = inlineIdAliases(String(code || ""));
  const issues = [];
  for (const profile of analyseProfiles(text)) {
    const points = profile.dangling.slice(0, 4).map(point => `(${+point.x.toFixed(3)}, ${+point.y.toFixed(3)})`).join(", ");
    issues.push({
      line: profile.solveAt >= 0 ? lineOf(text, profile.solveAt) : null,
      message: `Sketch "${profile.sketchId}" is not closed: the curve ends at ${points} (default sizes, inches) are not shared with another curve, so qSketchRegion finds no region and Onshape fails with "Cannot resolve entities". Add the missing segment(s) so the profile forms a closed loop.`,
      text: `skSolve(${profile.sketchVar})`,
    });
  }
  // A circle revolved about an axis through its own center cannot form a ring
  // (Onshape: REVOLVE_FAILED; a mug handle whose axis was line(handlePlane.origin, ...)).
  {
    const env = buildEnv(text);
    const calls = sketchCalls(text);
    const sketchOf = {};
    for (const m of text.matchAll(/\bvar\s+(\w+)\s*=\s*newSketchOnPlane\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{\s*"sketchPlane"\s*:\s*(\w+)\s*\}/g)) sketchOf[m[2]] = { sketchVar: m[1], planeVar: m[3] };
    const lineVars = Object.fromEntries([...text.matchAll(/\bvar\s+(\w+)\s*=\s*(line\s*\([^;]+\))\s*;/g)].map(m => [m[1], m[2]]));
    for (const m of text.matchAll(/\bopRevolve\s*\(\s*context\s*,\s*id\s*\+\s*"(\w+)"\s*,\s*\{([\s\S]*?)\}\s*\)\s*;/g)) {
      const sketchId = (m[2].match(/"entities"\s*:\s*qSketchRegion\s*\(\s*id\s*\+\s*"(\w+)"/) || [])[1];
      let axis = (m[2].match(/"axis"\s*:\s*([^\n]+?)\s*,?\s*\n/) || [])[1] || "";
      axis = lineVars[axis.trim()] || axis;
      const sketch = sketchOf[sketchId];
      if (!sketch) continue;
      const point = (axis.match(/^line\s*\(\s*([^,]+?)\s*,/) || [])[1];
      if (point !== `${sketch.planeVar}.origin`) continue;
      const centered = calls.filter(c => c.sketch === sketch.sketchVar && c.fn === "skCircle").some(c => {
        const center = evaluatePoint(mapEntry(c.map, "center") || "", env);
        return center && Math.hypot(center.x, center.y) < 1e-6;
      });
      if (centered) {
        issues.push({
          line: lineOf(text, m.index),
          message: `Revolve "${m[1]}": the axis goes through the center of the circle it revolves (axis point ${point}), so the profile crosses the axis and Onshape fails with REVOLVE_FAILED. Place the circle beside the axis: center it at vector(ringRadius, 0) and keep the axis at the sketch origin, or use an extruded ring instead.`,
          text: `opRevolve(context, id + "${m[1]}", ...)`,
        });
      }
    }
  }

  for (const bad of revolveAxesAlongNormal(text)) {
    issues.push({
      line: lineOf(text, bad.at),
      message: `Revolve "${bad.revolveId}": the axis points along the sketch plane's normal (${bad.direction}), so it is perpendicular to the profile and Onshape fails with "Revolved face is perpendicular to axis". The axis must lie IN the sketch plane: use line(${bad.planeVar}.origin, cross(${bad.planeVar}.normal, ${bad.planeVar}.x)) (the sketch's vertical y axis) and draw the half-profile at x >= 0 with one edge on x = 0.`,
      text: `opRevolve(context, id + "${bad.revolveId}", ...)`,
    });
  }

  for (const crossing of revolveCrossings(text)) {
    issues.push({
      line: lineOf(text, crossing.at),
      message: `Revolve "${crossing.revolveId}": its profile sketch "${crossing.sketchId}" spans both sides of the revolve axis (${crossing.coordinate} from ${+crossing.min.toFixed(3)} to ${+crossing.max.toFixed(3)} in), so Onshape fails with "Revolve would create self-intersecting part". Draw only the half-profile on one side of the axis (${crossing.coordinate} >= 0), with a straight edge on the axis.`,
      text: `opRevolve(context, id + "${crossing.revolveId}", ...)`,
    });
  }

  for (const sweep of analyseSweeps(text)) {
    const dir = sweep.tangent.slice(0, 2).map(v => +v.toFixed(2)).join(", ");
    issues.push({
      line: lineOf(text, sweep.plane.at),
      message: `The sweep profile plane "${sweep.planeVar}" faces along ${sweep.plane.normal}, but the path starts in direction (${dir}) of the sketch plane, so the profile lies along the path instead of across it and opSweep fails. Make the profile plane's normal the path's start direction${sweep.fixText ? ` (${sweep.fixText})` : ""}.`,
      text: sweep.plane.text.trim(),
    });
  }

  // Syntax and functions FeatureScript does not have (real Onshape errors from generated parts):
  // "[for ...]" list comprehensions ("no viable alternative at input '[for'"), JS arrow
  // functions and array methods, and invented ev* evaluators ("evFace ... not found").
  for (const match of text.matchAll(/\[\s*for\s*\(/g)) {
    issues.push({
      line: lineOf(text, match.index),
      message: `"[for (...) ...]" list syntax does not exist in FeatureScript (Onshape: "no viable alternative at input '[for'"). Build arrays with var list = []; for (var i = 0; i < n; i += 1) { list = append(list, value); }.`,
      text: match[0],
    });
  }
  for (const match of text.matchAll(/=>|\.(map|forEach|filter|reduce|push)\s*\(/g)) {
    issues.push({
      line: lineOf(text, match.index),
      message: `"${match[0].trim()}" is JavaScript, not FeatureScript: there are no arrow functions or array methods. Use for loops, append(array, value) and size(array).`,
      text: match[0],
    });
  }
  for (const match of text.matchAll(/\b(evFace|evEdge|evBody|evPoint|evNormal|evCenter|evCentroid|evRadius|evSketchPlane|evFacePlane)\s*\(/g)) {
    issues.push({
      line: lineOf(text, match.index),
      message: `${match[1]} does not exist in FeatureScript (Onshape: "Function ${match[1]} ... not found"). Use evPlane(context, { "face" : q }) for a planar face, evBox3d(context, { "topology" : q }) for extents, evVertexPoint(context, { "vertex" : q }) for a point, or compute positions from the parameters.`,
      text: match[0],
    });
  }

  // Sketch API misuse: skArc needs start/mid/end; some sk* helpers do not exist.
  for (const call of sketchCalls(text)) {
    if (call.fn === "skArc" && !(mapEntry(call.map, "start") && mapEntry(call.map, "mid") && mapEntry(call.map, "end"))) {
      issues.push({
        line: lineOf(text, call.start),
        message: `skArc "${call.name}" must be given "start", "mid" and "end" points (three points on the arc); keys like "center", "startPoint", "endPoint" or "direction" do not exist, so the sketch fails.`,
        text: `skArc(${call.sketch}, "${call.name}", ...)`,
      });
    }
  }
  for (const match of text.matchAll(/\b(skFillet|skChamfer|skOffset|skMirror|skPattern|skTrim|skPolygon|skSlot|skCircularPattern|skLinearPattern)\s*\(/g)) {
    issues.push({
      line: lineOf(text, match.index),
      message: `${match[1]} does not exist in FeatureScript. Build the profile from skLineSegment / skArc / skCircle / skRectangle / skRegularPolygon / skFitSpline; round 3D edges afterwards with opFillet.`,
      text: match[0],
    });
  }

  // opShell has no "removeFaces" option: the faces to open go in "entities" together
  // with nothing else, so the model's intended opening silently disappears.
  for (const match of text.matchAll(/\bopShell\s*\([^;]*?"removeFaces"\s*:/g)) {
    issues.push({
      line: lineOf(text, match.index),
      message: `opShell has no "removeFaces" option, so this opening is ignored and the body is shelled closed. Put the faces to remove in "entities" (for an extruded body: qCapEntity(id + "<extrude>", CapType.END, EntityType.FACE)); for a revolved body subtract an inner revolve with opBoolean instead.`,
      text: '"removeFaces"',
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
