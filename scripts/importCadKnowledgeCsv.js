import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  loadSeedEntriesFromCsv,
  toCadKnowledgeRecord,
  toCadMemoryRecord,
} from "./lib/cadSeedData.js";
// THIS IS USED TO IMPORT DATA, CAN PROBABLY 
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set to import CSV data.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function upsert(table, records, options) {
  const { error } = await supabase.from(table).upsert(records, options);
  if (error) {
    if (error.code === "42P10") {
      console.warn(`[Import] ${table} is missing the unique constraint needed for onConflict=${options?.onConflict || "(none)"}; inserting records whose titles are not present.`);
      const titles = records.map(record => record.title).filter(Boolean);
      const existing = titles.length
        ? await supabase.from(table).select("title").in("title", titles)
        : { data: [], error: null };
      if (existing.error) throw existing.error;
      const seen = new Set((existing.data || []).map(row => row.title));
      const missing = records.filter(record => !record.title || !seen.has(record.title));
      if (!missing.length) {
        console.log(`[Import] No new ${table} records to insert.`);
        return;
      }
      const inserted = await supabase.from(table).insert(missing);
      if (inserted.error) {
        if (inserted.error.code === "42501") {
          console.warn(`[Import] Skipped ${table} insert fallback because row-level security rejected anon inserts. Local CSV retrieval still works.`);
          return;
        }
        throw inserted.error;
      }
      console.log(`[Import] Inserted ${missing.length} records into ${table}.`);
      return;
    }
    throw error;
  }
  console.log(`[Import] Upserted ${records.length} records into ${table}.`);
}

async function run() {
  const filePath = process.argv[2] || "./data/cadKnowledge.csv";
  const isPruning = /pruning/i.test(filePath);
  const isMemoryExamples = /memory|example/i.test(filePath);
  const sourceTable = isPruning ? "pruning_table" : isMemoryExamples ? "cad_memory" : "cad_knowledge";
  const defaultMemoryType = isPruning ? "pruning_rule" : isMemoryExamples ? "example" : "seed";
  const entries = loadSeedEntriesFromCsv(filePath, {
    sourceTable,
    memoryType: defaultMemoryType,
    memoryOnly: sourceTable === "pruning_table" || sourceTable === "cad_memory",
  });

  if (!entries.length) {
    console.log("No valid rows found in CSV.");
    return;
  }

  const cadKnowledgeRecords = entries
    .map(toCadKnowledgeRecord)
    .filter(Boolean);
  const memoryRecords = entries
    .map(toCadMemoryRecord)
    .filter(Boolean);

  if (cadKnowledgeRecords.length) {
    await upsert("cad_knowledge", cadKnowledgeRecords, { onConflict: "title" });
  }
  await upsert("cad_memory", memoryRecords, { onConflict: "title" });
}

run().catch(err => {
  console.error("[Import] Failed:", err.message || err);
  process.exit(1);
});
