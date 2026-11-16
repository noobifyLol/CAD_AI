/**
 * unitFixer.js: repairs sums that mix plain numbers with lengths, the most common reason
 * generated FeatureScript compiles but fails when Onshape runs it ("cannot add -25.4 mm and
 * 0.05: units differ"). Models convert lengths to numbers (`/ inch`) and back (`* inch`) and
 * lose track of which variables are which.
 *
 * A small unit inference decides, for every term of a sum, whether it is a length (L) or a
 * number (N). Only sums that are certainly mixed (every term known, both kinds present) are
 * rewritten, so working code is never touched:
 *   (-halfW + 0.05) / inch            -> (-halfW + 0.05 * inch) / inch          (wanted: length)
 *   (capR - definition.pinR) * inch   -> (capR - definition.pinR / inch) * inch (wanted: number)
 *   var x = r + definition.offset;    -> var x = r * inch + definition.offset;  (default: length)
 */
const UNIT_NAMES = new Set(["inch", "millimeter", "centimeter", "meter", "foot", "yard"]);
const NUMBER_FUNCTIONS = new Set(["cos", "sin", "tan", "size", "floor", "ceil", "round"]);
const SAME_KIND_FUNCTIONS = new Set(["abs", "min", "max"]);

/** Index of the bracket that closes the one at `open`, or -1. Skips string literals. */
function closingIndex(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    } else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits at top-level binary operators from `ops`; returns [{ op, text }] (first op is ""). */
function splitTop(expr, ops) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let op = "";
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '"') {
      i += 1;
      while (i < expr.length && expr[i] !== '"') i += expr[i] === "\\" ? 2 : 1;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (depth === 0 && ops.includes(ch)) {
      const before = expr.slice(start, i).trimEnd();
      const prev = before.slice(-1);
      const exponent = /\d[eE]$/.test(before) && (ch === "+" || ch === "-");
      const unary = !before || "(*/,+-=<>!&|?:[{%~".includes(prev);
      if (unary || exponent) continue;
      parts.push({ op, text: expr.slice(start, i) });
      op = ch;
      start = i + 1;
    }
  }
  parts.push({ op, text: expr.slice(start) });
  return parts;
}

function isWrapped(text) {
  return text.startsWith("(") && closingIndex(text, 0) === text.length - 1;
}

function splitArgs(inner) {
  const args = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"') {
      i += 1;
      while (i < inner.length && inner[i] !== '"') i += inner[i] === "\\" ? 2 : 1;
    } else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args;
}

function buildEnvironment(code) {
  const lengths = new Set([...code.matchAll(/\bisLength\s*\(\s*definition\.(\w+)/g)].map(m => m[1]));
  const numbers = new Set([...code.matchAll(/\bis(?:Integer|Real)\s*\(\s*definition\.(\w+)/g)].map(m => m[1]));
  const defs = {};
  for (const m of code.matchAll(/\b(?:var|const)\s+(\w+)\s*=\s*/g)) {
    const start = m.index + m[0].length;
    let depth = 0;
    let end = start;
    for (; end < code.length; end += 1) {
      const ch = code[end];
      if ("([{".includes(ch)) depth += 1;
      else if (")]}".includes(ch)) depth -= 1;
      else if (ch === ";" && depth <= 0) break;
    }
    const name = m[1];
    defs[name] = name in defs ? null : code.slice(start, end); // declared twice: unknown
  }
  const counters = new Set([...code.matchAll(/\bfor\s*\(\s*var\s+(\w+)\s*=/g)].map(m => m[1]));
  for (const name of Object.keys(defs)) {
    if (counters.has(name)) continue;
    const assignments = code.match(new RegExp(`\\b${name}\\s*[-+*/]?=(?!=)`, "g")) || [];
    if (assignments.length > 1) defs[name] = null; // reassigned later: unknown
  }
  const memo = {};
  const env = { lengths, numbers, defs, counters, memo };
  return env;
}

/** "L" (length), "N" (number) or null (unknown: angles, vectors, strings, anything unclear). */
function kindOf(expr, env, depth = 0) {
  if (depth > 8) return null;
  const terms = splitTop(expr, "+-");
  if (terms.length > 1) {
    const kinds = terms.map(term => kindOfTerm(term.text, env, depth + 1));
    return kinds.every(kind => kind && kind === kinds[0]) ? kinds[0] : null;
  }
  return kindOfTerm(expr, env, depth);
}

function kindOfTerm(term, env, depth) {
  let exponent = 0;
  for (const factor of splitTop(term, "*/")) {
    const kind = kindOfFactor(factor.text, env, depth);
    if (!kind) return null;
    if (kind === "L") exponent += factor.op === "/" ? -1 : 1;
  }
  return exponent === 0 ? "N" : exponent === 1 ? "L" : null;
}

function kindOfFactor(raw, env, depth) {
  const factor = raw.trim().replace(/^[-+]\s*/, "");
  if (!factor) return null;
  if (isWrapped(factor)) return kindOf(factor.slice(1, -1), env, depth + 1);
  if (/^\d+(\.\d*)?([eE][-+]?\d+)?$|^\.\d+$/.test(factor)) return "N";
  if (UNIT_NAMES.has(factor)) return "L";
  if (factor === "PI") return "N";
  const parameter = factor.match(/^definition\.(\w+)$/);
  if (parameter) return env.lengths.has(parameter[1]) ? "L" : env.numbers.has(parameter[1]) ? "N" : null;
  if (/^[A-Za-z_]\w*$/.test(factor)) {
    if (env.counters.has(factor)) return "N";
    if (factor in env.memo) return env.memo[factor];
    if (!env.defs[factor]) return null;
    env.memo[factor] = null; // cycle guard
    env.memo[factor] = kindOf(env.defs[factor], env, depth + 1);
    return env.memo[factor];
  }
  const call = factor.match(/^([A-Za-z_]\w*)\s*\(/);
  if (call && closingIndex(factor, call[0].length - 1) === factor.length - 1) {
    const args = splitArgs(factor.slice(call[0].length, -1));
    if (NUMBER_FUNCTIONS.has(call[1])) return "N";
    if (call[1] === "sqrt") return kindOf(args[0] || "", env, depth + 1) === "N" ? "N" : null;
    if (SAME_KIND_FUNCTIONS.has(call[1])) {
      const kinds = args.map(arg => kindOf(arg, env, depth + 1));
      return kinds.every(kind => kind && kind === kinds[0]) ? kinds[0] : null;
    }
  }
  return null;
}

/** Rewrites certainly-mixed sums inside `expr`; `want` is "L", "N" or null (defaults to L). */
function fixExpression(expr, env, unit, want, counter) {
  const terms = splitTop(expr, "+-");
  if (terms.length > 1) {
    const kinds = terms.map(term => kindOfTerm(term.text, env, 0));
    if (kinds.every(Boolean) && kinds.includes("L") && kinds.includes("N")) {
      const target = want || "L";
      counter.count += 1;
      return terms.map((term, k) => {
        if (kinds[k] === target) return term.op + term.text;
        const lead = term.text.match(/^\s*/)[0];
        const trail = term.text.match(/\s*$/)[0];
        const body = term.text.trim();
        return `${term.op}${lead}${body} ${target === "L" ? "*" : "/"} ${unit}${trail}`;
      }).join("");
    }
  }
  // Not a mixed sum at this level: look inside brackets and call arguments.
  return terms.map(term => term.op + fixTerm(term.text, env, unit, counter)).join("");
}

function fixTerm(term, env, unit, counter) {
  const factors = splitTop(term, "*/");
  return factors.map((factor, k) => {
    const lead = factor.text.match(/^\s*(?:[-+]\s*)?/)[0];
    const trail = factor.text.match(/\s*$/)[0];
    const body = factor.text.slice(lead.length, factor.text.length - trail.length);
    const next = factors[k + 1];
    const nextIsUnit = next && UNIT_NAMES.has(next.text.trim());
    // (sum) / inch means the sum should be a length; (sum) * inch means it should be a number.
    const want = nextIsUnit ? (next.op === "/" ? "L" : "N") : null;
    let fixed = body;
    if (isWrapped(body)) {
      fixed = `(${fixExpression(body.slice(1, -1), env, unit, want, counter)})`;
    } else {
      const call = body.match(/^([A-Za-z_]\w*)\s*\(/);
      if (call && !/[{"]/.test(body) && closingIndex(body, call[0].length - 1) === body.length - 1) {
        const argWant = call[1] === "vector" && nextIsUnit && next.op === "*" ? "N" : null;
        const args = splitArgs(body.slice(call[0].length, -1)).map(arg => fixExpression(arg, env, unit, argWant, counter));
        fixed = `${call[0]}${args.join(",")})`;
      }
    }
    return factor.op + lead + fixed + trail;
  }).join("");
}

/** Returns { code, fixed } where fixed is the number of sums repaired. */
export function autoFixMixedUnits(source) {
  let code = String(source || "");
  const unit = (code.match(/\bmillimeter\b/g) || []).length > (code.match(/\binch\b/g) || []).length ? "millimeter" : "inch";
  const counter = { count: 0 };
  for (let pass = 0; pass < 3; pass += 1) {
    const before = counter.count;
    const env = buildEnvironment(code);
    // Every `var x = <expr>;` and every map value `"key" : <expr>`.
    const starts = /\b(?:var|const)\s+\w+\s*=\s*|"\w+"\s*:\s*/g;
    let out = "";
    let last = 0;
    let match;
    while ((match = starts.exec(code))) {
      const from = match.index + match[0].length;
      if ("{[".includes(code[from])) continue; // nested map or array: its own keys are visited
      let depth = 0;
      let to = from;
      for (; to < code.length; to += 1) {
        const ch = code[to];
        if (ch === '"') {
          to += 1;
          while (to < code.length && code[to] !== '"') to += code[to] === "\\" ? 2 : 1;
        } else if ("([{".includes(ch)) depth += 1;
        else if (")]}".includes(ch)) {
          if (depth === 0) break;
          depth -= 1;
        } else if ((ch === ";" || ch === ",") && depth === 0) break;
      }
      const expr = code.slice(from, to);
      if (!/[-+]/.test(expr) || /\b(function|if|for|while|return)\b/.test(expr)) continue;
      out += code.slice(last, from) + fixExpression(expr, env, unit, null, counter);
      last = to;
      starts.lastIndex = to;
    }
    code = out + code.slice(last);
    if (counter.count === before) break;
  }
  return { code, fixed: counter.count };
}
