import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createLearningService } from "../learning.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set to inspect the learning database.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const learning = createLearningService({
  supabase,
  cadKnowledgePath: new URL("../data/cadKnowledge.json", import.meta.url),
  fsDocsPath: new URL("../old_and_docs/docs/FS doc/", import.meta.url),
});

const report = await learning.diagnostics();

console.log("\nCAD learning database report");
console.log("============================");
console.log(`Connection: ${report.supabaseEnabled ? "connected" : "disabled"}`);
console.log(`Adaptive schema: ${report.schemaReady ? "ready" : `missing ${report.missingAdaptiveTables.join(", ")}`}`);
console.log(`FeatureScript docs: ${report.featureScriptDocs.enabled ? `${report.featureScriptDocs.chunks} indexed chunk(s)` : "not found"}`);
console.log(`Neural reranker: ${report.adaptiveNetwork.hiddenLayers.join("x")} hidden layers, ${report.adaptiveNetwork.trainedSteps} training step(s), source=${report.adaptiveNetwork.source}`);
console.log("");

for (const table of report.tables) {
  const status = table.available ? `${table.count} row(s)` : `missing/unavailable: ${table.error}`;
  console.log(`${table.table.padEnd(32)} ${status}`);
}

console.log("\nRecent generations");
if (report.recentGenerations.length === 0) {
  console.log("No visible generation rows yet.");
} else {
  report.recentGenerations.forEach(row => {
    const prompt = String(row.prompt || "").slice(0, 80);
    console.log(`- ${row.created_at} | ${row.shape_type || "UNKNOWN"} | rating=${row.user_rating || "-"} | ${prompt}`);
  });
}

console.log("\nTop CAD memory");
if (report.topMemory.length === 0) {
  console.log("No cad_memory rows visible yet. Run the migration, then npm run seed:knowledge.");
} else {
  report.topMemory.forEach(row => {
    console.log(`- q=${row.quality_score} uses=${row.usage_count} ok=${row.success_count} fail=${row.failure_count} | ${row.title}`);
  });
}
