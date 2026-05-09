import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "make", "build", "create",
  "using", "part", "model", "feature", "featurescript", "inch", "inches",
  "from", "into", "will", "have", "has", "need", "needs", "want", "wants",
  "image", "images", "photo", "drawing", "sketch", "dimension", "dimensions",
]);

const MISSING_DB_CODES = new Set(["42P01", "PGRST116", "PGRST202", "PGRST205", "42883"]);
const REQUIRED_ADAPTIVE_TABLES = [
  "cad_knowledge",
  "cad_memory",
  "cad_generation_memory_matches",
  "cad_feedback_events",
  "cad_memory_pruning_events",
];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function warnOnce(seen, key, message) {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(message);
}

export function extractKeywords(prompt, limit = 8) {
  const words = normalizeText(prompt)
    .toLowerCase()
    .match(/[a-z0-9_]+/g) || [];

  return [...new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word)))].slice(0, limit);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function dbLogResult({ id = null, ok = false, skipped = false, error = null, code = null, table = null, action = null, createdAt = new Date().toISOString(), details = null } = {}) {
  return { id, ok, skipped, error, code, table, action, createdAt, details };
}

function dbErrorResult(table, action, error) {
  return dbLogResult({
    ok: false,
    table,
    action,
    error: error?.message || String(error || "Unknown database error"),
    code: error?.code || null,
  });
}

function safeTextArray(value, limit = 8) {
  return (Array.isArray(value) ? value : [])
    .map(item => normalizeText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function clampQualityScore(value, fallback = 0.55) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function inferShapeFromPrompt(prompt) {
  const text = normalizeText(prompt).toLowerCase();
  const shapeHints = [
    ["ROBOT_MECH", /\b(robot|robotic|mech|mecha|android|humanoid)\b/],
    ["GEAR_SPUR", /\b(gear|spur|pinion|teeth|tooth|diametral pitch|module)\b/],
    ["FLANGE", /\b(flange|bolt circle|bore)\b/],
    ["L_BRACKET", /\b(l bracket|angle bracket|corner bracket)\b/],
    ["T_BRACKET", /\b(t bracket|tee bracket|t-plate)\b/],
    ["LINKAGE", /\b(linkage|connecting rod|coupler|lever arm)\b/],
    ["PLATE_HOLES", /\b(plate|mounting plate).*\b(hole|holes|bolt)\b/],
    ["BUSHING", /\b(bushing|sleeve|liner|journal bearing)\b/],
    ["WASHER", /\b(washer|shim|spacer disk|flat ring)\b/],
    ["HITCH_PEG", /\b(hitch peg|mushroom pin|domed pin|peg)\b/],
    ["CYLINDER", /\b(cylinder|rod|shaft|tube)\b/],
    ["BOX", /\b(box|block|body|housing|chassis|enclosure)\b/],
    ["POLYGON", /\b(hex|hexagon|triangle|polygon|octagon)\b/],
  ];

  return shapeHints.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function scoreText(promptKeywords, fields) {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return promptKeywords.reduce((score, keyword) => {
    return haystack.includes(keyword) ? score + 1 : score;
  }, 0);
}

function scoreKnowledgeEntry(prompt, entry) {
  const keywords = extractKeywords(prompt, 10);
  return scoreText(keywords, [
    entry.title,
    entry.summary,
    ...(entry.tags || []),
    ...(entry.keywords || []),
    ...(entry.parameterHints || entry.parameter_hints || []),
    ...(entry.modelingNotes || entry.modeling_notes || []),
  ]);
}

function scoreGeneration(promptKeywords, shapeHint, row) {
  const ratingBoost = Number(row.user_rating || 0) >= 4 ? 3 : Number(row.user_rating || 0) === 3 ? 1 : 0;
  const shapeBoost = shapeHint && row.shape_type === shapeHint ? 3 : 0;
  const textScore = scoreText(promptKeywords, [row.prompt, row.shape_type, row.thinking]);
  return ratingBoost + shapeBoost + textScore;
}

function scoreMemory(promptKeywords, shapeHint, row) {
  const quality = Number(row.quality_score ?? 0.5);
  const shapeBoost = shapeHint && row.shape_type === shapeHint ? 3 : 0;
  const textScore = scoreText(promptKeywords, [
    row.title,
    row.summary,
    row.shape_type,
    ...(row.tags || []),
    ...(row.keywords || []),
    ...(row.parameter_hints || []),
    ...(row.modeling_notes || []),
    ...(row.failure_modes || []),
    ...(row.validation_rules || []),
  ]);

  return quality * 2 + shapeBoost + textScore;
}

function mapLocalKnowledge(entry) {
  return {
    memory_type: "local_seed",
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags || [],
    keywords: entry.keywords || [],
    parameter_hints: entry.parameterHints || [],
    modeling_notes: entry.modelingNotes || [],
    example_prompt: entry.example_prompt || null,
    quality_score: 0.65,
  };
}

function mapCadKnowledge(row) {
  return {
    memory_type: "seed",
    title: row.title,
    summary: row.summary,
    tags: row.tags || [],
    keywords: row.keywords || [],
    parameter_hints: row.parameter_hints || [],
    modeling_notes: row.modeling_notes || [],
    example_prompt: row.example_prompt || null,
    quality_score: 0.7,
  };
}

function mapShapeKnowledge(row) {
  return {
    memory_type: "shape_default",
    title: `${row.shape_type} defaults`,
    summary: row.description || row.notes || "",
    shape_type: row.shape_type,
    tags: row.aliases || [],
    keywords: [row.shape_type, ...(row.aliases || [])].filter(Boolean),
    parameter_hints: row.default_dims ? [`Default dimensions: ${JSON.stringify(row.default_dims)}`] : [],
    modeling_notes: row.notes ? [row.notes] : [],
    quality_score: 0.7,
  };
}

function mapCadMemory(row) {
  return {
    id: row.id,
    memory_type: row.memory_type || "skill",
    title: row.title,
    summary: row.summary || "",
    shape_type: row.shape_type || null,
    tags: row.tags || [],
    keywords: row.keywords || [],
    parameter_hints: row.parameter_hints || [],
    modeling_notes: row.modeling_notes || [],
    feature_pattern: row.feature_pattern || "",
    failure_modes: row.failure_modes || [],
    validation_rules: row.validation_rules || [],
    quality_score: Number(row.quality_score ?? 0.5),
    usage_count: Number(row.usage_count || 0),
    success_count: Number(row.success_count || 0),
    failure_count: Number(row.failure_count || 0),
    _score: Number(row.match_score ?? row._score ?? 0),
  };
}

function dedupeKnowledge(entries, limit = 8) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    const key = normalizeText(`${entry.title || ""}:${entry.shape_type || ""}`).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

function isMissingDbObject(error) {
  return MISSING_DB_CODES.has(error?.code);
}

function toFsPath(value) {
  if (!value) return null;
  return value instanceof URL ? fileURLToPath(value) : String(value);
}

function listMarkdownFiles(rootPath) {
  if (!rootPath || !existsSync(rootPath)) return [];

  const found = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(next);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        found.push(next);
      }
    }
  };

  visit(rootPath);
  return found;
}

function firstMeaningfulLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => normalizeText(line.replace(/^#+\s*/, "")))
    .find(line => line && !line.startsWith("[text](")) || "";
}

function isReadableDocTitle(line) {
  return /^[A-Z][A-Za-z0-9 /(),._-]{4,90}$/.test(line) && !/[{}":;=]/.test(line);
}

function chunkDocument(text, maxChars = 1800, overlapChars = 0) {
  const normalized = String(text || "")
    .replace(/\r/g, "")
    .replace(/\t/g, "  ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf("\n\n", end);
      const lineBreak = normalized.lastIndexOf("\n", end);
      const splitAt = paragraphBreak > start + 600 ? paragraphBreak : lineBreak > start + 600 ? lineBreak : end;
      end = splitAt;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

function buildFeatureScriptDocIndex(fsDocsPath) {
  const rootPath = toFsPath(fsDocsPath);
  if (!rootPath || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    return { rootPath, chunks: [] };
  }

  const chunks = [];
  for (const filePath of listMarkdownFiles(rootPath)) {
    const source = relative(rootPath, filePath).replace(/\\/g, "/");
    const fileTitle = basename(filePath, ".md").replace(/[-_]/g, " ");
    const text = readFileSync(filePath, "utf8");

    chunkDocument(text).forEach((chunk, index) => {
      const lead = firstMeaningfulLine(chunk);
      const title = isReadableDocTitle(lead) ? `${fileTitle}: ${lead}` : `${fileTitle} ${index + 1}`;
      chunks.push({
        title,
        source,
        text: normalizeText(chunk).slice(0, 1800),
        keywords: extractKeywords(`${title} ${source} ${chunk}`, 28),
      });
    });
  }

  return { rootPath, chunks };
}

function expandedDocKeywords(prompt, keywords, shapeHint) {
  const text = normalizeText(prompt).toLowerCase();
  const expanded = new Set([
    ...keywords,
    "featurescript",
    "definefeature",
    "precondition",
    "islength",
    "sketch",
    "sksolve",
    "qsketchregion",
    "opextrude",
  ]);

  if (shapeHint) expanded.add(shapeHint.toLowerCase());
  if (/\b(round|cylinder|shaft|rod|pin|bore|hole|circle|washer|bushing|flange)\b/.test(text)) {
    ["opCylinder", "skCircle", "evAxis", "qCreatedBy"].forEach(term => expanded.add(term.toLowerCase()));
  }
  if (/\b(curve|curved|organic|freeform|smooth|handle|bowl|scoop|spoon|loft|sweep|spline)\b/.test(text)) {
    ["opLoft", "opSweep", "skFitSpline", "opRevolve", "opFillet", "opThicken"].forEach(term => expanded.add(term.toLowerCase()));
  }
  if (/\b(gear|teeth|tooth|pattern|array|repeat)\b/.test(text)) {
    ["for", "opPattern", "transform", "cos", "sin"].forEach(term => expanded.add(term.toLowerCase()));
  }
  if (/\b(debug|error|compile|enum|type|predicate|operator|syntax)\b/.test(text)) {
    ["syntax", "semantics", "types", "annotations", "predicate"].forEach(term => expanded.add(term));
  }

  return [...expanded].filter(Boolean);
}

function scoreDocChunk(doc, docKeywords) {
  const haystack = `${doc.title} ${doc.source} ${doc.text}`.toLowerCase();
  const titleHaystack = `${doc.title} ${doc.source}`.toLowerCase();
  const operationTerms = new Set([
    "oploft",
    "opsweep",
    "oprevolve",
    "opfillet",
    "opthicken",
    "opextrude",
    "skfitspline",
    "skcircle",
    "sksolve",
    "qsketchregion",
    "definefeature",
    "islength",
  ]);

  const keywordScore = docKeywords.reduce((score, keyword) => {
    const needle = String(keyword || "").toLowerCase();
    if (!needle) return score;
    if (titleHaystack.includes(needle)) score += 3;
    if (haystack.includes(needle)) score += operationTerms.has(needle) ? 5 : 1;
    return score;
  }, 0);

  const source = doc.source.toLowerCase();
  const sourceBoost = source === "fs doc.md"
    ? 3
    : source.includes("fs guide/modeling") || source.includes("language reference/syntax")
      ? 2
      : source.includes("language reference/toplevel") || source.includes("language reference/types") || source.includes("fs guide/ui")
        ? 1
        : 0;
  const sourcePenalty = source.includes("customtables") || source.includes("partproerties") ? 3 : 0;

  return keywordScore + sourceBoost - sourcePenalty;
}

function foundationalDocBoost(doc) {
  const haystack = `${doc.title} ${doc.source} ${doc.text}`.toLowerCase();
  const anchors = [
    "defines a custom feature",
    "precondition",
    "operations are standard library functions",
    "sketches can be created",
    "sksolve",
    "qsketchregion",
    "oploft",
    "opsweep",
    "oprevolve",
  ];
  return anchors.some(anchor => haystack.includes(anchor)) ? 1 : 0;
}

function priorityDocTerms(prompt) {
  const text = normalizeText(prompt).toLowerCase();
  if (/\b(curve|curved|organic|freeform|smooth|handle|bowl|scoop|spoon|loft|sweep|spline)\b/.test(text)) {
    return ["oploft", "opsweep", "skfitspline", "oprevolve"];
  }
  if (/\b(debug|error|compile|enum|type|predicate|operator|syntax)\b/.test(text)) {
    return ["syntax", "types", "predicate", "annotation"];
  }
  if (/\b(round|cylinder|shaft|rod|pin|bore|hole|circle|washer|bushing|flange)\b/.test(text)) {
    return ["skcircle", "opcylinder", "qcreatedby"];
  }
  return [];
}

function excerptAroundTerms(text, terms, maxChars = 1400) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const term = terms.find(item => lower.includes(item));
  if (!term || normalized.length <= maxChars) return normalized.slice(0, maxChars);

  const index = lower.indexOf(term);
  const start = Math.max(0, index - 280);
  return normalized.slice(start, start + maxChars).trim();
}

export function createLearningService({ supabase, cadKnowledgePath, fsDocsPath }) {
  const warned = new Set();
  const localCadKnowledge = JSON.parse(readFileSync(cadKnowledgePath, "utf8"));
  const featureScriptDocIndex = buildFeatureScriptDocIndex(fsDocsPath);

  if (fsDocsPath && !featureScriptDocIndex.chunks.length) {
    warnOnce(warned, "fs_docs", `[Docs] FeatureScript docs were not found at ${toFsPath(fsDocsPath)}.`);
  }

  function getLocalKnowledge(prompt, limit = 4) {
    if (!prompt) return [];

    return [...localCadKnowledge]
      .map(entry => ({ ...mapLocalKnowledge(entry), _score: scoreKnowledgeEntry(prompt, entry) }))
      .filter(entry => entry._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  function getFeatureScriptDocs(prompt, keywords, shapeHint, limit = 4) {
    if (!featureScriptDocIndex.chunks.length) return [];

    const docKeywords = expandedDocKeywords(prompt, keywords, shapeHint);
    const priorityTerms = priorityDocTerms(prompt);
    const selected = [];
    const seen = new Set();
    const addDoc = doc => {
      const key = `${doc.source}:${doc.title}:${doc.text.slice(0, 40)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      selected.push(doc);
      return true;
    };

    for (const term of priorityTerms) {
      const priorityDoc = featureScriptDocIndex.chunks
        .filter(doc => `${doc.title} ${doc.text}`.toLowerCase().includes(term))
        .map(doc => ({
          ...doc,
          text: excerptAroundTerms(doc.text, [term]),
          _score: scoreDocChunk(doc, docKeywords) + foundationalDocBoost(doc) + 8,
        }))
        .sort((a, b) => b._score - a._score)[0];
      if (priorityDoc) addDoc(priorityDoc);
      if (selected.length >= limit) return selected;
    }

    const ranked = featureScriptDocIndex.chunks
      .map(doc => ({ ...doc, _score: scoreDocChunk(doc, docKeywords) + foundationalDocBoost(doc) }))
      .filter(doc => doc._score > 0)
      .sort((a, b) => b._score - a._score);

    for (const doc of ranked) {
      addDoc(doc);
      if (selected.length >= limit) return selected.slice(0, limit);
    }
    if (selected.length >= limit) return selected.slice(0, limit);

    const fallback = featureScriptDocIndex.chunks
      .map(doc => ({ ...doc, _score: foundationalDocBoost(doc) }))
      .filter(doc => doc._score > 0);

    for (const doc of fallback) {
      addDoc(doc);
      if (selected.length >= limit) return selected.slice(0, limit);
    }
    return selected.slice(0, limit);
  }

  async function fetchGenerationExamples(prompt, keywords, shapeHint) {
    if (!supabase || !prompt) return [];

    let query = supabase
      .from("generations")
      .select("id,prompt,shape_type,confidence,dims,featurescript,thinking,user_rating,user_feedback,created_at")
      .order("created_at", { ascending: false })
      .limit(24);

    if (keywords.length) {
      const filters = keywords
        .flatMap(keyword => [`prompt.ilike.%${keyword}%`, `shape_type.ilike.%${keyword}%`])
        .join(",");
      query = query.or(filters);
    }

    const { data, error } = await query;
    if (error) {
      warnOnce(warned, "generations", `[DB] Could not load learning examples: ${error.message}`);
      return [];
    }

    return (Array.isArray(data) ? data : [])
      .filter(row => row?.featurescript && Number(row.user_rating || 3) >= 3)
      .map(row => ({ ...row, _score: scoreGeneration(keywords, shapeHint, row) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 4);
  }

  async function fetchCadMemory(prompt, keywords, shapeHint) {
    if (!supabase) return [];

    const rpc = await supabase.rpc("search_cad_memory", {
      query_text: prompt,
      query_keywords: keywords,
      query_shape: shapeHint,
      match_limit: 8,
    });

    if (!rpc.error && Array.isArray(rpc.data)) {
      return rpc.data.map(mapCadMemory);
    }

    if (rpc.error && !isMissingDbObject(rpc.error)) {
      warnOnce(warned, "search_cad_memory", `[DB] CAD memory RPC unavailable: ${rpc.error.message}`);
    }

    const { data, error } = await supabase
      .from("cad_memory")
      .select("id,memory_type,title,summary,shape_type,tags,keywords,parameter_hints,modeling_notes,feature_pattern,failure_modes,validation_rules,quality_score,usage_count,success_count,failure_count,is_active")
      .eq("is_active", true)
      .limit(32);

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "cad_memory", `[DB] Could not load CAD memory: ${error.message}`);
      return [];
    }

    return (Array.isArray(data) ? data : [])
      .map(row => ({ ...mapCadMemory(row), _score: scoreMemory(keywords, shapeHint, row) }))
      .filter(row => row._score > 0.5)
      .sort((a, b) => b._score - a._score)
      .slice(0, 8);
  }

  async function fetchCadKnowledge(keywords) {
    if (!supabase) return [];

    let query = supabase
      .from("cad_knowledge")
      .select("title,summary,tags,keywords,parameter_hints,modeling_notes,example_prompt")
      .limit(16);

    if (keywords.length) {
      const filters = keywords
        .flatMap(keyword => [
          `title.ilike.%${keyword}%`,
          `summary.ilike.%${keyword}%`,
          `keywords.cs.{${keyword}}`,
          `tags.cs.{${keyword}}`,
        ])
        .join(",");
      query = query.or(filters);
    }

    const { data, error } = await query;
    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "cad_knowledge", `[DB] Could not load CAD knowledge: ${error.message}`);
      return [];
    }

    return (Array.isArray(data) ? data : []).map(mapCadKnowledge);
  }

  async function fetchShapeKnowledge(shapeHint, keywords) {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("shape_knowledge")
      .select("shape_type,aliases,description,default_dims,notes")
      .limit(24);

    if (error) {
      if (!isMissingDbObject(error)) warnOnce(warned, "shape_knowledge", `[DB] Could not load shape knowledge: ${error.message}`);
      return [];
    }

    return (Array.isArray(data) ? data : [])
      .map(row => {
        const mapped = mapShapeKnowledge(row);
        return { ...mapped, _score: scoreMemory(keywords, shapeHint, mapped) };
      })
      .filter(row => row.shape_type === shapeHint || row._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 4);
  }

  async function markMemoryUsed(memoryIds) {
    if (!supabase || !memoryIds.length) return;

    const { error } = await supabase.rpc("mark_cad_memory_used", { memory_ids: memoryIds });
    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "mark_cad_memory_used", `[DB] Could not mark CAD memory usage: ${error.message}`);
    }
  }

  async function fetchLearningContext(prompt) {
    const keywords = extractKeywords(prompt);
    const shapeHint = inferShapeFromPrompt(prompt);
    const [examples, cadMemory, cadKnowledge, shapeKnowledge] = await Promise.all([
      fetchGenerationExamples(prompt, keywords, shapeHint),
      fetchCadMemory(prompt, keywords, shapeHint),
      fetchCadKnowledge(keywords),
      fetchShapeKnowledge(shapeHint, keywords),
    ]);

    const localKnowledge = getLocalKnowledge(prompt);
    const featureScriptDocs = getFeatureScriptDocs(prompt, keywords, shapeHint);
    const memoryMatches = cadMemory
      .filter(memory => memory.id)
      .slice(0, 8)
      .map((memory, index) => ({
        memory_id: memory.id,
        score_rank: index + 1,
        score_snapshot: Number(memory._score || 0),
      }));

    await markMemoryUsed(memoryMatches.map(match => match.memory_id));

    const notes = [];
    if (shapeHint) notes.push(`Fast shape hint from prompt: ${shapeHint}.`);
    if (cadMemory.length) notes.push(`Using ${cadMemory.length} scored CAD memory record(s). Prefer higher-scored active memories over old raw examples.`);
    if (featureScriptDocs.length) notes.push(`Using ${featureScriptDocs.length} local FeatureScript documentation snippet(s) from old_and_docs/docs/FS doc.`);
    if (examples.length) {
      const shapes = [...new Set(examples.map(example => example.shape_type).filter(Boolean))];
      if (shapes.length) notes.push(`Related prior generation shapes: ${shapes.join(", ")}.`);
    }

    return {
      prompt,
      keywords,
      shapeHint,
      examples,
      notes,
      memoryMatches,
      featureScriptDocs,
      knowledge: dedupeKnowledge([
        ...cadMemory,
        ...shapeKnowledge,
        ...cadKnowledge,
        ...localKnowledge,
      ], 8),
    };
  }

  async function linkMemoryMatches(generationId, matches = []) {
    if (!supabase || !generationId || !matches.length) return;

    const rows = matches.map(match => ({
      generation_id: generationId,
      memory_id: match.memory_id,
      score_rank: match.score_rank,
      score_snapshot: match.score_snapshot,
    }));

    const { error } = await supabase
      .from("cad_generation_memory_matches")
      .insert(rows);

    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "cad_generation_memory_matches", `[DB] Could not link CAD memory to generation: ${error.message}`);
    }
  }

  async function logGeneration(prompt, result, metadata = {}) {
    if (!supabase) {
      return dbLogResult({
        skipped: true,
        table: "generations",
        action: "insert",
        error: "Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
      });
    }

    const payload = {
      prompt,
      shape_type: result?.dims?.shape || null,
      confidence: result?.dims?.confidence || null,
      dims: jsonSafe(result?.dims),
      featurescript: result?.code || "",
      thinking: result?.thinking || "",
    };

    const { data, error } = await supabase
      .from("generations")
      .insert([payload])
      .select("id,created_at")
      .single();

    if (error) {
      warnOnce(warned, "log_generation", `[DB] Failed to log generation: ${error.message}`);
      return dbErrorResult("generations", "insert", error);
    }

    await linkMemoryMatches(data?.id, metadata.learningContext?.memoryMatches || []);
    return dbLogResult({
      id: data?.id || null,
      ok: Boolean(data?.id),
      table: "generations",
      action: "insert",
      createdAt: data?.created_at || new Date().toISOString(),
    });
  }

  async function logImageAnalysis({ imageCount, imageContexts, globalPrompt, aiDescription, generationId }) {
    if (!supabase) {
      return dbLogResult({
        skipped: true,
        table: "image_analyses",
        action: "insert",
        error: "Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
      });
    }

    const { data, error } = await supabase.from("image_analyses").insert([{
      image_count: imageCount,
      image_contexts: imageContexts || [],
      global_prompt: globalPrompt || "",
      ai_description: aiDescription || "",
      generation_id: generationId || null,
    }]).select("id,created_at").single();

    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "image_analyses", `[DB] Failed to log image analysis: ${error.message}`);
    }
    if (error) return dbErrorResult("image_analyses", "insert", error);
    return dbLogResult({
      id: data?.id || null,
      ok: Boolean(data?.id),
      table: "image_analyses",
      action: "insert",
      createdAt: data?.created_at || new Date().toISOString(),
    });
  }

  async function logDebugSession({ originalCode, errorMessages, fixedCode, explanation }) {
    if (!supabase) {
      return dbLogResult({
        skipped: true,
        table: "debug_sessions",
        action: "insert",
        error: "Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
      });
    }

    const { data, error } = await supabase.from("debug_sessions").insert([{
      original_code: originalCode || "",
      error_messages: errorMessages || "",
      fixed_code: fixedCode || "",
      explanation: explanation || "",
    }]).select("id,created_at").single();

    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "debug_sessions", `[DB] Failed to log debug session: ${error.message}`);
    }
    if (error) return dbErrorResult("debug_sessions", "insert", error);
    return dbLogResult({
      id: data?.id || null,
      ok: Boolean(data?.id),
      table: "debug_sessions",
      action: "insert",
      createdAt: data?.created_at || new Date().toISOString(),
    });
  }

  function defaultFeedbackWeight(signal, rating) {
    if (Number.isFinite(Number(rating))) return (Number(rating) - 3) * 0.04;

    return {
      copied: 0.04,
      good: 0.08,
      helpful: 0.08,
      debug_requested: -0.03,
      compile_error: -0.08,
      needs_fix: -0.08,
      bad: -0.12,
    }[signal] ?? 0;
  }

  async function recordFeedback({ generationId, signal = "feedback", rating, feedback, weight }) {
    if (!supabase || !generationId) {
      return {
        ok: false,
        skipped: true,
        createdAt: new Date().toISOString(),
        error: !supabase ? "Supabase is disabled." : "No generationId provided.",
      };
    }

    const safeRating = Number.isFinite(Number(rating))
      ? Math.max(1, Math.min(5, Math.round(Number(rating))))
      : null;
    const safeWeight = Number.isFinite(Number(weight))
      ? Number(weight)
      : defaultFeedbackWeight(signal, safeRating);

    const rpc = await supabase.rpc("record_cad_feedback", {
      p_generation_id: generationId,
      p_signal: signal,
      p_weight: safeWeight,
      p_notes: feedback || null,
      p_rating: safeRating,
    });

    if (!rpc.error) {
      return { ok: true, weight: safeWeight, createdAt: new Date().toISOString() };
    }
    if (rpc.error && !isMissingDbObject(rpc.error)) {
      warnOnce(warned, "record_cad_feedback_rpc", `[DB] Feedback RPC failed: ${rpc.error.message}`);
    }

    const event = await supabase.from("cad_feedback_events").insert([{
      generation_id: generationId,
      signal,
      rating: safeRating,
      weight: safeWeight,
      notes: feedback || null,
    }]);

    if (event.error && !isMissingDbObject(event.error)) {
      warnOnce(warned, "cad_feedback_events", `[DB] Failed to log feedback event: ${event.error.message}`);
    }

    const updatePayload = {};
    if (safeRating) updatePayload.user_rating = safeRating;
    if (feedback) updatePayload.user_feedback = feedback;

    if (Object.keys(updatePayload).length) {
      const { error } = await supabase
        .from("generations")
        .update(updatePayload)
        .eq("id", generationId);
      if (error) warnOnce(warned, "feedback_generation_update", `[DB] Failed to update generation feedback: ${error.message}`);
    }

    return {
      ok: !event.error || isMissingDbObject(event.error),
      weight: safeWeight,
      createdAt: new Date().toISOString(),
      error: event.error && !isMissingDbObject(event.error) ? event.error.message : null,
    };
  }

  async function fetchGenerationSnapshot({ generationId, prompt }) {
    if (!supabase) {
      return {
        supabaseEnabled: false,
        generation: null,
        memoryMatches: [],
        feedbackEvents: [],
        diagnostics: await diagnostics(),
      };
    }

    let generation = null;
    if (generationId) {
      const { data, error } = await supabase
        .from("generations")
        .select("id,created_at,prompt,shape_type,confidence,dims,thinking,user_rating,user_feedback,char_count")
        .eq("id", generationId)
        .maybeSingle();
      if (!error) generation = data || null;
    }

    if (!generation && prompt) {
      const { data, error } = await supabase
        .from("generations")
        .select("id,created_at,prompt,shape_type,confidence,dims,thinking,user_rating,user_feedback,char_count")
        .ilike("prompt", `%${String(prompt).slice(0, 80)}%`)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!error && Array.isArray(data)) generation = data[0] || null;
    }

    const matches = generation?.id
      ? await supabase
          .from("cad_generation_memory_matches")
          .select("score_rank,score_snapshot,cad_memory(id,title,shape_type,quality_score,usage_count,success_count,failure_count)")
          .eq("generation_id", generation.id)
          .order("score_rank", { ascending: true })
      : { data: [], error: null };

    const feedback = generation?.id
      ? await supabase
          .from("cad_feedback_events")
          .select("signal,rating,weight,notes,created_at")
          .eq("generation_id", generation.id)
          .order("created_at", { ascending: false })
          .limit(8)
      : { data: [], error: null };

    return {
      supabaseEnabled: true,
      generation,
      memoryMatches: matches.error ? [] : matches.data || [],
      feedbackEvents: feedback.error ? [] : feedback.data || [],
      diagnostics: await diagnostics(),
    };
  }

  async function saveLearningAnalysis({ analysis, prompt, generationId, signal, rating, feedback }) {
    if (!supabase) {
      return dbLogResult({
        skipped: true,
        table: "cad_memory",
        action: "upsert",
        error: "Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
      });
    }

    const candidate = analysis?.memoryCandidate || analysis?.memory_candidate || null;
    if (!candidate?.title) {
      return dbLogResult({
        skipped: true,
        table: "cad_memory",
        action: "upsert",
        error: "AI analysis did not produce a memory candidate.",
      });
    }

    const shapeHint = candidate.shape_type || candidate.shapeType || inferShapeFromPrompt(prompt);
    const title = normalizeText(candidate.title).slice(0, 120);
    const summaryParts = [
      normalizeText(candidate.summary || analysis?.summary || ""),
      generationId ? `Source generation: ${generationId}.` : "",
      signal ? `Signal: ${signal}.` : "",
      rating ? `Rating: ${rating}.` : "",
      feedback ? `Feedback: ${normalizeText(feedback).slice(0, 240)}` : "",
    ].filter(Boolean);

    const payload = {
      memory_type: "feedback_lesson",
      title,
      summary: summaryParts.join(" "),
      shape_type: shapeHint || null,
      tags: safeTextArray(candidate.tags || ["feedback", "generated"]),
      keywords: safeTextArray(candidate.keywords || extractKeywords(prompt, 8)),
      parameter_hints: safeTextArray(candidate.parameterHints || candidate.parameter_hints),
      modeling_notes: safeTextArray(candidate.modelingNotes || candidate.modeling_notes),
      feature_pattern: normalizeText(candidate.featurePattern || candidate.feature_pattern || "").slice(0, 1000) || null,
      failure_modes: safeTextArray(candidate.failureModes || candidate.failure_modes),
      validation_rules: safeTextArray(candidate.validationRules || candidate.validation_rules),
      quality_score: clampQualityScore(candidate.qualityScore ?? candidate.quality_score, signal === "good" || Number(rating) >= 4 ? 0.68 : 0.45),
      source_table: "cad_feedback_events",
      is_active: true,
    };

    const { data, error } = await supabase
      .from("cad_memory")
      .upsert([payload], { onConflict: "title" })
      .select("id,created_at")
      .single();

    if (error) {
      warnOnce(warned, "save_learning_analysis", `[DB] Failed to save AI learning analysis: ${error.message}`);
      return dbErrorResult("cad_memory", "upsert", error);
    }

    return dbLogResult({
      id: data?.id || null,
      ok: Boolean(data?.id),
      table: "cad_memory",
      action: "upsert",
      createdAt: data?.created_at || new Date().toISOString(),
    });
  }

  async function countTable(table) {
    if (!supabase) return { table, available: false, count: 0, error: "Supabase disabled" };

    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact" })
      .limit(1);

    return {
      table,
      available: !error,
      count: count || 0,
      error: error?.message || null,
    };
  }

  async function diagnostics() {
    const tables = await Promise.all([
      "generations",
      "cad_knowledge",
      "shape_knowledge",
      "cad_memory",
      "cad_generation_memory_matches",
      "cad_feedback_events",
      "cad_memory_pruning_events",
      "image_analyses",
      "debug_sessions",
    ].map(countTable));

    const recentGenerations = supabase
      ? await supabase
          .from("generations")
          .select("id,created_at,prompt,shape_type,confidence,user_rating,char_count")
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: [], error: null };

    const topMemory = supabase
      ? await supabase
          .from("cad_memory")
          .select("id,title,shape_type,quality_score,usage_count,success_count,failure_count,is_active")
          .order("quality_score", { ascending: false })
          .limit(8)
      : { data: [], error: null };
    const missingAdaptiveTables = tables
      .filter(table => REQUIRED_ADAPTIVE_TABLES.includes(table.table) && !table.available)
      .map(table => table.table);

    return {
      supabaseEnabled: Boolean(supabase),
      schemaReady: missingAdaptiveTables.length === 0,
      missingAdaptiveTables,
      featureScriptDocs: {
        enabled: featureScriptDocIndex.chunks.length > 0,
        chunks: featureScriptDocIndex.chunks.length,
        source: featureScriptDocIndex.rootPath ? "old_and_docs/docs/FS doc" : null,
      },
      tables,
      recentGenerations: recentGenerations.error ? [] : recentGenerations.data || [],
      topMemory: topMemory.error ? [] : topMemory.data || [],
      notes: [
        "generations stores raw prompts, extracted dimensions, output code, reasoning, and user feedback.",
        "cad_memory stores scored CAD skill records used for retrieval, promotion, demotion, and pruning.",
        "cad_generation_memory_matches links each generated result to the exact memories that influenced it.",
        "cad_feedback_events turns copy/helpful/debug signals into quality-score updates for those memories.",
        "If cad_memory or cad_feedback_events are missing, run supabase/migrations/20260505213000_adaptive_cad_memory.sql, then npm run seed:knowledge.",
      ],
    };
  }

  return {
    fetchLearningContext,
    logGeneration,
    logImageAnalysis,
    logDebugSession,
    recordFeedback,
    fetchGenerationSnapshot,
    saveLearningAnalysis,
    diagnostics,
  };
}
