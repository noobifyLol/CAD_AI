import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function toFsPath(value) {
  if (!value) return null;
  return value instanceof URL ? fileURLToPath(value) : String(value);
}

export function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseArray(value) {
  if (!value) return [];
  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed)
        ? parsed.map(item => normalizeText(item)).filter(Boolean)
        : [];
    } catch {
      // Ignore malformed JSON-like array text and fall through to split mode.
    }
  }

  return text
    .split(/[,;|]/)
    .map(item => normalizeText(item))
    .filter(Boolean);
}

export function parseCsv(text) {
  const lines = String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .filter(Boolean);

  if (!lines.length) return [];

  const header = lines[0]
    .split(/,(?=(?:[^"]*"[^"]*")*(?![^"]*"))/)
    .map(column => column.trim().replace(/^"|"$/g, ""));

  return lines.slice(1).map(line => {
    const values = line
      .split(/,(?=(?:[^"]*"[^"]*")*(?![^"]*"))/)
      .map(value => value.trim().replace(/^"|"$/g, ""));

    return header.reduce((record, key, index) => {
      record[key] = values[index] ?? "";
      return record;
    }, {});
  });
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = normalizeText(value).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeShapeType(value) {
  const text = normalizeText(value);
  return text ? text.toUpperCase() : null;
}

export function toSeedEntry(record = {}, defaults = {}) {
  const title = normalizeText(record.title);
  if (!title) return null;

  const memoryType = normalizeText(record.memory_type || record.memoryType || defaults.memoryType || "seed") || "seed";
  const sourceTable = normalizeText(record.source_table || record.sourceTable || defaults.sourceTable || "cad_knowledge") || "cad_knowledge";
  const memoryOnly = parseBoolean(record.memory_only || record.memoryOnly, defaults.memoryOnly || memoryType === "pruning_rule");

  return {
    title,
    summary: normalizeText(record.summary || ""),
    tags: parseArray(record.tags),
    keywords: parseArray(record.keywords),
    parameterHints: parseArray(record.parameter_hints || record.parameterHints),
    modelingNotes: parseArray(record.modeling_notes || record.modelingNotes),
    featurePattern: normalizeText(record.feature_pattern || record.featurePattern || ""),
    failureModes: parseArray(record.failure_modes || record.failureModes),
    validationRules: parseArray(record.validation_rules || record.validationRules),
    examplePrompt: normalizeText(record.example_prompt || record.examplePrompt || ""),
    shapeType: normalizeShapeType(record.shape_type || record.shapeType || defaults.shapeType),
    memoryType,
    qualityScore: parseNumber(record.quality_score || record.qualityScore, defaults.qualityScore ?? (memoryType === "pruning_rule" ? 0.82 : 0.7)),
    sourceTable,
    memoryOnly,
  };
}

export function dedupeSeedEntries(entries = []) {
  const byTitle = new Map();
  for (const entry of entries) {
    if (!entry?.title) continue;
    byTitle.set(normalizeText(entry.title).toLowerCase(), entry);
  }
  return [...byTitle.values()];
}

export function loadSeedEntriesFromCsv(fileRef, defaults = {}) {
  const filePath = toFsPath(fileRef);
  if (!filePath || !existsSync(filePath)) return [];

  const text = readFileSync(filePath, "utf8");
  return dedupeSeedEntries(
    parseCsv(text)
      .map(record => toSeedEntry(record, defaults))
      .filter(Boolean)
  );
}

export function loadSeedEntriesFromJson(fileRef, defaults = {}) {
  const filePath = toFsPath(fileRef);
  if (!filePath || !existsSync(filePath)) return [];

  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) return [];

  return dedupeSeedEntries(
    raw.map(record => toSeedEntry(record, defaults)).filter(Boolean)
  );
}

export function isPruningEntry(entry) {
  return Boolean(
    entry?.memoryOnly
    || entry?.memoryType === "pruning_rule"
    || entry?.sourceTable === "pruning_table"
  );
}

export function toCadKnowledgeRecord(entry) {
  if (!entry || isPruningEntry(entry)) return null;

  return {
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags || [],
    keywords: entry.keywords || [],
    parameter_hints: entry.parameterHints || [],
    modeling_notes: entry.modelingNotes || [],
    example_prompt: entry.examplePrompt || null,
  };
}

export function toCadMemoryRecord(entry) {
  if (!entry) return null;

  return {
    memory_type: entry.memoryType || "seed",
    title: entry.title,
    summary: entry.summary,
    shape_type: entry.shapeType || null,
    tags: entry.tags || [],
    keywords: entry.keywords || [],
    parameter_hints: entry.parameterHints || [],
    modeling_notes: entry.modelingNotes || [],
    feature_pattern: entry.featurePattern || null,
    failure_modes: entry.failureModes || [],
    validation_rules: entry.validationRules || [],
    quality_score: Number.isFinite(Number(entry.qualityScore)) ? Number(entry.qualityScore) : 0.7,
    source_table: entry.sourceTable || "cad_knowledge",
    is_active: true,
  };
}
