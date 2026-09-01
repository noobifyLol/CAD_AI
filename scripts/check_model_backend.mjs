// Verifies whichever CADFS-2B backend is configured — local or cloud.
// Usage:
//   npm run model:check                      (uses CADFS_MODEL_URL, default localhost)
//   npm run model:check -- https://you--cadfs-2b-web.modal.run
import dotenv from "dotenv";
dotenv.config();

const url = (process.argv[2] || process.env.CADFS_MODEL_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const isRemote = /^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(url);
console.log(`[check] backend: ${url}  (${isRemote ? "remote/cloud" : "local"})`);

async function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

let failures = 0;
try {
  const started = Date.now();
  const health = await withTimeout(
    signal => fetch(`${url}/health`, { signal }),
    isRemote ? 300000 : 15000
  );
  const body = await health.json();
  console.log(`[check] /health -> ${health.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`, JSON.stringify(body));
  if (!health.ok) failures += 1;
} catch (err) {
  failures += 1;
  console.log(`[check] /health FAILED: ${err.message}${isRemote ? " (cold start can take a while; try again)" : " (start it: npm run model:serve)"}`);
}

if (!failures) {
  try {
    const started = Date.now();
    const res = await withTimeout(
      signal => fetch(`${url}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "A rectangular plate 50 mm by 30 mm and 4 mm thick with a 6 mm diameter hole through the center." }),
        signal,
      }),
      isRemote ? 300000 : 180000
    );
    const data = await res.json();
    const code = data.featurescript || "";
    const wallSec = ((Date.now() - started) / 1000).toFixed(1);
    const looksValid = /FeatureScript\s+\d+\s*;/.test(code) && /defineFeature/.test(code);
    console.log(`[check] /generate -> ${res.status} in ${wallSec}s (model ${data.elapsedSec}s) | ${code.length} chars | looksLikeFeatureScript=${looksValid}`);
    console.log(`[check] first line: ${code.split("\n")[0] || "(empty)"}`);
    if (!looksValid) failures += 1;
  } catch (err) {
    failures += 1;
    console.log(`[check] /generate FAILED: ${err.message}`);
  }
}

console.log(failures === 0 ? "\n[check] BACKEND OK" : `\n[check] ${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
