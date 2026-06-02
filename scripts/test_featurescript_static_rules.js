import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// No-network static rule tests for FeatureScript compiler-agent upgrade.
// This script is expected to be wired into ai.js via exported validateFeatureScriptStrict.

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_PATH = join(PROJECT_ROOT, "..", "data", "fs_static_fixtures.json");

function loadFixtures() {
  if (!existsSync(FIXTURES_PATH)) {
    throw new Error(`Missing fixtures file: ${FIXTURES_PATH}`);
  }
  const raw = readFileSync(FIXTURES_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.fixtures)) throw new Error("Fixtures JSON must contain { fixtures: [...] }");
  return parsed.fixtures;
}

async function main() {
  const { validateFeatureScriptStrict } = await import("../ai.js");
  if (typeof validateFeatureScriptStrict !== "function") {
    throw new Error("ai.js must export validateFeatureScriptStrict(code)." );
  }

  const fixtures = loadFixtures();
  let passed = 0;
  let failed = 0;

  for (const fx of fixtures) {
    const code = String(fx.code || "");
    const wantStrictPass = fx.expectStrictPass;
    let res;
    try {
      res = validateFeatureScriptStrict(code);
    } catch (err) {
      if (wantStrictPass === false) {
        passed += 1;
        continue;
      }
      failed += 1;
      console.error(`FAIL [${fx.name}] threw unexpectedly:`, err?.message || String(err));
      continue;
    }

    const gotStrictPass = Boolean(res?.strictPass);
    if (gotStrictPass === Boolean(wantStrictPass)) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL [${fx.name}] strictPass expected=${wantStrictPass} got=${gotStrictPass}`);
      console.error("fatalIssues:", res?.fatalIssues?.map(x=>x.message));
      console.error("validationIssues:", res?.validationIssues?.map(x=>x.message));
      console.error("appliedSanitizers:", res?.appliedSanitizers);
    }
  }

  console.log(`fs-static-tests: passed=${passed} failed=${failed} total=${fixtures.length}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

