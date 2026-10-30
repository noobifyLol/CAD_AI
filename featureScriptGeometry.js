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
