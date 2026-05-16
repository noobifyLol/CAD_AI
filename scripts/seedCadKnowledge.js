import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  dedupeSeedEntries,
  loadSeedEntriesFromCsv,
  loadSeedEntriesFromJson,
  toCadKnowledgeRecord,
  toCadMemoryRecord,
} from "./lib/cadSeedData.js";
// This file is just used to add Knowledge to the database ------THIS CAN BE REMOVED LATER
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set before seeding CAD knowledge.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const shapeByTitle = new Map([
  ["Parametric Box Body", "BOX"],
  ["Bushing Or Sleeve", "BUSHING"],
  ["Linkage Arm", "LINKAGE"],
  ["Flange With Bolt Circle", "FLANGE"],
  ["L Bracket", "L_BRACKET"],
  ["Hitch Peg Or Mushroom Pin", "HITCH_PEG"],
  ["Spur Gear", "GEAR_SPUR"],
  ["Slotted Mounting Plate", "PLATE_HOLES"],
]);

const jsonSeedEntries = loadSeedEntriesFromJson(new URL("../data/cadKnowledge.json", import.meta.url), {
  memoryType: "seed",
  qualityScore: 0.7,
  sourceTable: "cad_knowledge",
}).map(entry => ({
  ...entry,
  shapeType: entry.shapeType || shapeByTitle.get(entry.title) || null,
}));

const csvSeedEntries = loadSeedEntriesFromCsv(new URL("../data/cadKnowledge.csv", import.meta.url), {
  memoryType: "seed",
  qualityScore: 0.75,
  sourceTable: "cad_knowledge",
});

const pruningEntries = loadSeedEntriesFromCsv(new URL("../data/cadPruningTable.csv", import.meta.url), {
  memoryType: "pruning_rule",
  qualityScore: 0.82,
  sourceTable: "pruning_table",
  memoryOnly: true,
});

const newKnowledgeEntries = loadSeedEntriesFromCsv(new URL("../data/cadKnowledge.new.csv", import.meta.url), {
  memoryType: "seed",
  qualityScore: 0.84,
  sourceTable: "cad_knowledge",
});

const newPruningEntries = loadSeedEntriesFromCsv(new URL("../data/cadPruningTable.new.csv", import.meta.url), {
  memoryType: "pruning_rule",
  qualityScore: 0.88,
  sourceTable: "pruning_table",
  memoryOnly: true,
});

const memoryExampleEntries = loadSeedEntriesFromCsv(new URL("../data/cadMemoryExamples.new.csv", import.meta.url), {
  memoryType: "example",
  qualityScore: 0.9,
  sourceTable: "cad_memory",
  memoryOnly: true,
});

const allEntries = dedupeSeedEntries([
  ...jsonSeedEntries,
  ...csvSeedEntries,
  ...pruningEntries,
  ...newKnowledgeEntries,
  ...newPruningEntries,
  ...memoryExampleEntries,
]);

const cadKnowledgeRecords = allEntries
  .map(toCadKnowledgeRecord)
  .filter(Boolean);

const memoryRecords = allEntries
  .map(toCadMemoryRecord)
  .filter(Boolean);

async function upsert(table, records, options) {
  const { error } = await supabase.from(table).upsert(records, options);
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) {
      console.warn(`[Seed] Skipped ${table}; run the adaptive CAD memory migration first.`);
      return;
    }
    if (error.code === "42P10") {
      console.warn(`[Seed] ${table} is missing the unique constraint needed for onConflict=${options?.onConflict || "(none)"}; inserting records whose titles are not present.`);
      const titles = records.map(record => record.title).filter(Boolean);
      const existing = titles.length
        ? await supabase.from(table).select("title").in("title", titles)
        : { data: [], error: null };
      if (existing.error) throw existing.error;
      const seen = new Set((existing.data || []).map(row => row.title));
      const missing = records.filter(record => !record.title || !seen.has(record.title));
      if (!missing.length) {
        console.log(`[Seed] No new ${table} records to insert.`);
        return;
      }
      const inserted = await supabase.from(table).insert(missing);
      if (inserted.error) {
        if (inserted.error.code === "42501") {
          console.warn(`[Seed] Skipped ${table} insert fallback because row-level security rejected anon inserts. Local CSV retrieval still works.`);
          return;
        }
        throw inserted.error;
      }
      console.log(`[Seed] Inserted ${missing.length} records into ${table}.`);
      return;
    }
    throw error;
  }
  console.log(`[Seed] Upserted ${records.length} records into ${table}.`);
}

await upsert("cad_knowledge", cadKnowledgeRecords, { onConflict: "title" });
await upsert("cad_memory", memoryRecords, { onConflict: "title" });
