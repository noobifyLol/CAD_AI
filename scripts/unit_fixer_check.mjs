// Regression test for unitFixer.js: mixed number/length sums are repaired, everything else
// is left exactly as written.   node scripts/unit_fixer_check.mjs
import { readdirSync, readFileSync } from "node:fs";
import { autoFixMixedUnits } from "../unitFixer.js";

const header = `isLength(definition.width, x);
isLength(definition.pinR, x);
isInteger(definition.count, x);
var halfW = definition.width / 2;
var capR = definition.width / inch;
var n = 3;
`;
const cases = [
  // [input line, expected line]
  ['"firstCorner" : vector((-halfW + 0.05) / inch, 0) * inch,', '"firstCorner" : vector((-halfW + 0.05 * inch) / inch, 0) * inch,'],
  ["var c = origin + normal * (capR - definition.pinR) * inch;", "var c = origin + normal * (capR - definition.pinR / inch) * inch;"],
  ["var x = capR + definition.pinR;", "var x = capR * inch + definition.pinR;"],
  ["var y = halfW - 0.25;", "var y = halfW - 0.25 * inch;"],
  ["var z = halfW + n * definition.pinR - 1.5e-2;", "var z = halfW + n * definition.pinR - 1.5e-2 * inch;"],
  // unchanged: consistent, unknown, vectors, strings, angles, loops
  ["var a = halfW + definition.pinR * 2;", null],
  ["var b = capR * 2 + n;", null],
  ["var p = skPlane.origin + skPlane.normal * halfW;", null],
  ['var s = id + "hole" + i;', null],
  ["var ang = 30 * degree + offsetAngle;", null],
  ["for (var i = 0; i < definition.count; i += 1)", null],
  ["var q = vector(halfW, -halfW);", null],
  ['"radius" : definition.width / 2 - definition.pinR,', null],
];
let failures = 0;
for (const [input, expected] of cases) {
  const out = autoFixMixedUnits(header + input).code.slice(header.length);
  const want = expected ?? input;
  if (out === want) console.log(`PASS ${input}`);
  else { failures += 1; console.log(`FAIL ${input}\n     got  ${out}\n     want ${want}`); }
}
// The verified example library must come through untouched.
const dir = new URL("../data/fs_examples/", import.meta.url);
for (const file of readdirSync(dir).filter(name => name.endsWith(".fs"))) {
  const code = readFileSync(new URL(file, dir), "utf8");
  const result = autoFixMixedUnits(code);
  if (result.code !== code) { failures += 1; console.log(`FAIL example changed: ${file} (${result.fixed} edits)`); }
}
console.log(failures === 0 ? "\nALL UNIT FIXER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
