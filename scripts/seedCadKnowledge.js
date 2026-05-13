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

const allEntries = dedupeSeedEntries([
  ...jsonSeedEntries,
  ...csvSeedEntries,
  ...pruningEntries,
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
      console.warn(`[Seed] Skipped ${table}; the table is missing the unique constraint needed for onConflict=${options?.onConflict || "(none)"}.`);
      return;
    }
    throw error;
  }
  console.log(`[Seed] Upserted ${records.length} records into ${table}.`);
}

await upsert("cad_knowledge", cadKnowledgeRecords, { onConflict: "title" });
await upsert("cad_memory", memoryRecords, { onConflict: "title" });
