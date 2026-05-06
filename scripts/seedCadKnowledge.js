import "dotenv/config";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const rawRecords = JSON.parse(
  readFileSync(new URL("../data/cadKnowledge.json", import.meta.url), "utf8")
);

const cadKnowledgeRecords = rawRecords.map(entry => ({
  title: entry.title,
  summary: entry.summary,
  tags: entry.tags || [],
  keywords: entry.keywords || [],
  parameter_hints: entry.parameterHints || [],
  modeling_notes: entry.modelingNotes || [],
  example_prompt: entry.example_prompt || null,
}));

const memoryRecords = rawRecords.map(entry => ({
  memory_type: "seed",
  title: entry.title,
  summary: entry.summary,
  shape_type: shapeByTitle.get(entry.title) || null,
  tags: entry.tags || [],
  keywords: entry.keywords || [],
  parameter_hints: entry.parameterHints || [],
  modeling_notes: entry.modelingNotes || [],
  feature_pattern: entry.featurePattern || null,
  failure_modes: entry.failureModes || [],
  validation_rules: entry.validationRules || [],
  quality_score: 0.7,
  source_table: "cad_knowledge",
}));

async function upsert(table, records, options) {
  const { error } = await supabase.from(table).upsert(records, options);
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) {
      console.warn(`[Seed] Skipped ${table}; run the adaptive CAD memory migration first.`);
      return;
    }
    throw error;
  }
  console.log(`[Seed] Upserted ${records.length} records into ${table}.`);
}

await upsert("cad_knowledge", cadKnowledgeRecords, { onConflict: "title" });
await upsert("cad_memory", memoryRecords, { onConflict: "title" });
