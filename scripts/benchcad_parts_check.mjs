// Regression test for benchcadParts.js: prompts that simply name a standard part get it; prompts
// that ask for anything specific (sizes, counts, features) are left to the AI.
//   node scripts/benchcad_parts_check.mjs
import { benchcadInfo, benchcadPart } from "../benchcadParts.js";

const cases = [
  ["a hex nut", "hex_nut"],
  ["a nut", "hex_nut"],
  ["a washer", "washer"],
  ["an L bracket", "l_bracket"],
  ["a bracket", "l_bracket"],
  ["a pipe flange", "pipe_flange"],
  ["a stepped shaft", "stepped_shaft"],
  ["a pillow block", "pillow_block"],
  ["a phone stand", "phone_stand"],
  ["a coat hook", "j_hook"],
  ["a chair", "chair"],
  ["a small table", "table"],
  ["an electronics enclosure", "enclosure"],
  ["a gridfinity bin", "gridfinity_bin"],
  // specific requests go to the AI
  ["a pipe flange with 4 bolt holes", null],
  ["a phone stand with a cable hole", null],
  ["a 20 mm washer", null],
  ["a coffee mug", null],
  ["a spur gear", null],
  ["a box with a lid", null],
];
let failures = 0;
const info = benchcadInfo();
if (info.parts < 200) { failures += 1; console.log(`FAIL library has only ${info.parts} parts`); }
for (const [prompt, want] of cases) {
  const got = benchcadPart(prompt)?.family || null;
  if (got === want) console.log(`PASS ${prompt} -> ${got || "AI"}`);
  else { failures += 1; console.log(`FAIL ${prompt}: got ${got || "AI"}, want ${want || "AI"}`); }
}
const nut = benchcadPart("a hex nut");
if (!nut || !/defineFeature/.test(nut.code) || !/definition\.scale/.test(nut.code)) { failures += 1; console.log("FAIL standard part code is not a scalable feature"); }
console.log(failures === 0 ? `\nALL STANDARD PART CHECKS PASSED (${info.parts} parts, ${info.families} families)` : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
