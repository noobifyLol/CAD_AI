// Batch test, step 1: send prompts to a running site and save each FeatureScript.
//   node scripts/eval/generate.mjs <outDir> <siteUrl> <parallel> "prompt one | prompt two | ..."
// Then: node scripts/eval/check.mjs <outDir>   (builds every file in both checkers)
import { mkdirSync, writeFileSync } from "node:fs";

const [outDir, base, parallel, ...rest] = process.argv.slice(2);
const prompts = rest.join(" ").split("|").map(s => s.trim()).filter(Boolean);
mkdirSync(outDir, { recursive: true });
let next = 0;
async function worker() {
  while (next < prompts.length) {
    const i = next++;
    const prompt = prompts[i];
    const started = Date.now();
    for (let tries = 0; tries < 30; tries += 1) {
      try {
        const r = await fetch(`${base}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: AbortSignal.timeout(400000),
        });
        const d = await r.json();
        const code = d.featureScript || d.code || "";
        const stem = `${outDir}/${String(i).padStart(2, "0")}_${prompt.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30)}`;
        if (code) writeFileSync(`${stem}.fs`, code);
        writeFileSync(`${stem}.json`, JSON.stringify({ prompt, status: r.status, seconds: Math.round((Date.now() - started) / 1000), generationMode: d.generationMode, completionLevel: d.completionLevel, error: d.error, warnings: d.warnings, omissions: d.omissions }, null, 2));
        console.log(r.status, d.generationMode || d.error || "", `${Math.round((Date.now() - started) / 1000)}s`, prompt);
        break;
      } catch (err) {
        if (tries % 5 === 0) console.log(`retrying (${err?.cause?.code || err?.name || "error"}: ${String(err?.message || err).slice(0, 80)})`, prompt);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(parallel) || 1 }, worker));
