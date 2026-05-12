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
  if (error) throw error;
  console.log(`[Import] Upserted ${records.length} records into ${table}.`);
}

async function run() {
  const filePath = process.argv[2] || "./data/cadKnowledge.csv";
  const sourceTable = /pruning/i.test(filePath) ? "pruning_table" : "cad_knowledge";
  const defaultMemoryType = sourceTable === "pruning_table" ? "pruning_rule" : "seed";
  const entries = loadSeedEntriesFromCsv(filePath, {
    sourceTable,
    memoryType: defaultMemoryType,
    memoryOnly: sourceTable === "pruning_table",
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
