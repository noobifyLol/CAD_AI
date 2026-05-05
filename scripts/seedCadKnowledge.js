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

const records = JSON.parse(
  readFileSync(new URL("../data/cadKnowledge.json", import.meta.url), "utf8")
).map(entry => ({
  title: entry.title,
  summary: entry.summary,
  tags: entry.tags || [],
  keywords: entry.keywords || [],
  parameter_hints: entry.parameterHints || [],
  modeling_notes: entry.modelingNotes || [],
  example_prompt: entry.example_prompt || null,
}));

const { error } = await supabase
  .from("cad_knowledge")
  .upsert(records, { onConflict: "title" });

if (error) {
  throw error;
}

console.log(`[Seed] Upserted ${records.length} CAD knowledge records into cad_knowledge.`);
