import "dotenv/config";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set to import CSV data.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(/,(?=(?:[^"]*"[^"]*")*(?![^"]*"))/).map(col => col.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = line.split(/,(?=(?:[^"]*"[^"]*")*(?![^"]*"))/).map(value => value.trim().replace(/^"|"$/g, ""));
    const record = {};
    for (let i = 0; i < header.length; i += 1) {
      record[header[i]] = values[i] ?? "";
    }
    return record;
  });
}

function parseArray(value) {
  if (!value) return [];
  if (value.trim().startsWith("[") && value.trim().endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean) : [];
    } catch {
      // ignore JSON parse errors
    }
  }
  return value.split(/[,;|]/).map(item => item.trim()).filter(Boolean);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function mapRecord(record) {
  return {
    title: normalizeText(record.title),
    summary: normalizeText(record.summary || ""),
    tags: parseArray(record.tags),
    keywords: parseArray(record.keywords),
    parameter_hints: parseArray(record.parameter_hints || record.parameterHints),
    modeling_notes: parseArray(record.modeling_notes || record.modelingNotes),
    example_prompt: normalizeText(record.example_prompt || record.examplePrompt || ""),
    source_table: "cad_knowledge",
  };
}

function buildMemoryRecord(record) {
  const entry = mapRecord(record);
  const shapeType = normalizeText(record.shape_type || record.shapeType || "").toUpperCase() || null;
  return {
    memory_type: "seed",
    title: entry.title,
    summary: entry.summary,
    shape_type: shapeType || null,
    tags: entry.tags,
    keywords: entry.keywords,
    parameter_hints: entry.parameter_hints,
    modeling_notes: entry.modeling_notes,
    feature_pattern: normalizeText(record.feature_pattern || record.featurePattern || ""),
    failure_modes: parseArray(record.failure_modes || record.failureModes),
    validation_rules: parseArray(record.validation_rules || record.validationRules),
    quality_score: 0.7,
    source_table: "cad_knowledge",
    is_active: true,
  };
}

async function upsert(table, records, options) {
  const { error } = await supabase.from(table).upsert(records, options);
  if (error) throw error;
  console.log(`[Import] Upserted ${records.length} records into ${table}.`);
}

async function run() {
  const filePath = process.argv[2] || "./data/cadKnowledge.csv";
  const raw = readFileSync(filePath, "utf8");
  const rows = parseCsv(raw).filter(row => row.title);

  if (!rows.length) {
    console.log("No valid rows found in CSV.");
    return;
  }

  const cadKnowledgeRecords = rows.map(mapRecord);
  const memoryRecords = rows.map(buildMemoryRecord);

  await upsert("cad_knowledge", cadKnowledgeRecords, { onConflict: "title" });
  await upsert("cad_memory", memoryRecords, { onConflict: "title" });
}

run().catch(err => {
  console.error("[Import] Failed:", err.message || err);
  process.exit(1);
});
