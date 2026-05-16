/**
 * cadSeedData.js
 * Shared helpers for loading, normalising, deduplicating, and converting
 * CAD knowledge seed data from JSON or CSV into Supabase-ready records.
 *
 * Imported by:
 *   scripts/seedCadKnowledge.js
 *   scripts/importCadKnowledgeCsv.js
 *   learning.js
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toPath(value) {
  if (!value) return null;
  return value instanceof URL ? fileURLToPath(value) : String(value);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Parse a delimited string (semicolon or pipe) into a trimmed array.
 * Works on both CSV multi-value fields and JSON arrays that may have been
 * serialised as strings.
 */
function parseDelimited(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  if (!value || typeof value !== "string") return [];
  // Accept semicolons, pipes, or newlines as separators
  return value
    .split(/[;|\n]+/)
    .map(s => normalizeText(s))
    .filter(Boolean);
}

function clampScore(value, fallback = 0.65) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return fallback;
}

// Shape type registry — keeps CSV/JSON values consistent with AI.js constants
const KNOWN_SHAPES = new Set([
  "BOX", "ROBOT_MECH", "CYLINDER", "PLATE", "POLYGON", "LINKAGE",
  "PLATE_HOLES", "L_BRACKET", "T_BRACKET", "FLANGE", "HEX_NUT",
  "WASHER", "BUSHING", "HITCH_PEG", "GEAR_SPUR", "CUSTOM",
]);

function normalizeShapeType(value) {
  const upper = String(value ?? "").toUpperCase().trim();
  return KNOWN_SHAPES.has(upper) ? upper : null;
}

// ─── Core normaliser ──────────────────────────────────────────────────────────

/**
 * Convert a raw parsed object (from JSON or CSV) into a canonical seed entry.
 * All fields are safe to pass directly to toCadKnowledgeRecord / toCadMemoryRecord.
 */
function normalizeSeedEntry(raw, options = {}) {
  const {
    memoryType = "seed",
    qualityScore = 0.65,
    sourceTable = "cad_knowledge",
    memoryOnly = false,
  } = options;

  const title = normalizeText(raw.title || raw.Title || "");
  if (!title) return null; // skip blank rows

  return {
    title,
    summary: normalizeText(raw.summary || raw.Summary || ""),
    tags: parseDelimited(raw.tags || raw.Tags || []),
    keywords: parseDelimited(raw.keywords || raw.Keywords || []),
    parameterHints: parseDelimited(raw.parameter_hints || raw.parameterHints || raw["Parameter Hints"] || []),
    modelingNotes: parseDelimited(raw.modeling_notes || raw.modelingNotes || raw["Modeling Notes"] || []),
    featurePattern: normalizeText(raw.feature_pattern || raw.featurePattern || raw["Feature Pattern"] || ""),
    failureModes: parseDelimited(raw.failure_modes || raw.failureModes || raw["Failure Modes"] || []),
    validationRules: parseDelimited(raw.validation_rules || raw.validationRules || raw["Validation Rules"] || []),
    examplePrompt: normalizeText(raw.example_prompt || raw.examplePrompt || raw["Example Prompt"] || ""),
    shapeType: normalizeShapeType(raw.shape_type || raw.shapeType || raw["Shape Type"] || ""),
    memoryType: normalizeText(raw.memory_type || raw.memoryType || memoryType),
    qualityScore: clampScore(raw.quality_score ?? raw.qualityScore ?? qualityScore),
    sourceTable: normalizeText(raw.source_table || raw.sourceTable || sourceTable),
    memoryOnly: parseBoolean(raw.memory_only ?? raw.memoryOnly, memoryOnly),
  };
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

/**
 * Minimal RFC-4180-compatible CSV parser.
 * Handles quoted fields with embedded commas and newlines.
 */
function parseCsv(text) {
  const lines = [];
  let field = "";
  let inQuote = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuote) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        if (ch === "\r") i++;
        row.push(field);
        field = "";
        lines.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  // flush last field/row
  row.push(field);
  if (row.some(f => f.trim())) lines.push(row);

  if (lines.length < 2) return [];

  const headers = lines[0].map(h => h.trim());
  return lines.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? "").trim();
    });
    return obj;
  });
}

// ─── Public loaders ───────────────────────────────────────────────────────────

/**
 * Load seed entries from a JSON file (array of objects).
 */
export function loadSeedEntriesFromJson(pathOrUrl, options = {}) {
  const filePath = toPath(pathOrUrl);
  if (!filePath || !existsSync(filePath)) {
    console.warn(`[cadSeedData] JSON file not found: ${filePath}`);
    return [];
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`[cadSeedData] Failed to parse JSON: ${filePath}`, err.message);
    return [];
  }

  if (!Array.isArray(raw)) {
    console.warn(`[cadSeedData] JSON file is not an array: ${filePath}`);
    return [];
  }

  return raw
    .map(entry => normalizeSeedEntry(entry, options))
    .filter(Boolean);
}

/**
 * Load seed entries from a CSV file.
 * Expected columns (case-sensitive, comma-separated):
 *   title, summary, tags, keywords, parameter_hints, modeling_notes,
 *   feature_pattern, failure_modes, validation_rules, example_prompt,
 *   shape_type, memory_type, quality_score, source_table, memory_only
 */
export function loadSeedEntriesFromCsv(pathOrUrl, options = {}) {
  const filePath = toPath(pathOrUrl);
  if (!filePath || !existsSync(filePath)) {
    console.warn(`[cadSeedData] CSV file not found: ${filePath}`);
    return [];
  }

  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[cadSeedData] Failed to read CSV: ${filePath}`, err.message);
    return [];
  }

  const rows = parseCsv(text);
  if (!rows.length) {
    console.warn(`[cadSeedData] CSV has no data rows: ${filePath}`);
    return [];
  }

  return rows
    .map(row => normalizeSeedEntry(row, options))
    .filter(Boolean);
}

/**
 * Deduplicate seed entries by title (case-insensitive).
 * Later entries win if titles collide (allows CSV to override JSON defaults).
 */
export function dedupeSeedEntries(entries) {
  const seen = new Map();
  for (const entry of entries) {
    const key = normalizeText(entry.title).toLowerCase();
    seen.set(key, entry); // last-write wins
  }
  return [...seen.values()];
}

// ─── Record converters ────────────────────────────────────────────────────────

/**
 * Convert a normalised seed entry into a cad_knowledge table row.
 * Returns null if memoryOnly is true (pruning rules don't go into cad_knowledge).
 */
export function toCadKnowledgeRecord(entry) {
  if (!entry || entry.memoryOnly) return null;
  return {
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    keywords: entry.keywords,
    parameter_hints: entry.parameterHints,
    modeling_notes: entry.modelingNotes,
    example_prompt: entry.examplePrompt || null,
  };
}

/**
 * Convert a normalised seed entry into a cad_memory table row.
 */
export function toCadMemoryRecord(entry) {
  if (!entry) return null;
  return {
    memory_type: entry.memoryType || "seed",
    title: entry.title,
    summary: entry.summary,
    shape_type: entry.shapeType || null,
    tags: entry.tags,
    keywords: entry.keywords,
    parameter_hints: entry.parameterHints,
    modeling_notes: entry.modelingNotes,
    feature_pattern: entry.featurePattern || null,
    failure_modes: entry.failureModes,
    validation_rules: entry.validationRules,
    quality_score: entry.qualityScore,
    source_table: entry.sourceTable || "cad_knowledge",
    is_active: true,
  };
}
