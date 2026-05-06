import { readFileSync } from "node:fs";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "make", "build", "create",
  "using", "part", "model", "feature", "featurescript", "inch", "inches",
  "from", "into", "will", "have", "has", "need", "needs", "want", "wants",
  "image", "images", "photo", "drawing", "sketch", "dimension", "dimensions",
]);

const MISSING_DB_CODES = new Set(["42P01", "PGRST116", "PGRST202", "PGRST205", "42883"]);

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

function inferShapeFromPrompt(prompt) {
  const text = normalizeText(prompt).toLowerCase();
  const shapeHints = [
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

export function createLearningService({ supabase, cadKnowledgePath }) {
  const warned = new Set();
  const localCadKnowledge = JSON.parse(readFileSync(cadKnowledgePath, "utf8"));

  function getLocalKnowledge(prompt, limit = 4) {
    if (!prompt) return [];

    return [...localCadKnowledge]
      .map(entry => ({ ...mapLocalKnowledge(entry), _score: scoreKnowledgeEntry(prompt, entry) }))
      .filter(entry => entry._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
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
    if (!supabase) return null;

    const payload = {
      prompt,
      shape_type: result?.dims?.shape || null,
      confidence: result?.dims?.confidence || null,
      dims: jsonSafe(result?.dims),
      featurescript: result?.code || "",
      thinking: result?.thinking || "",
      char_count: String(result?.code || "").length,
    };

    const { data, error } = await supabase
      .from("generations")
      .insert([payload])
      .select("id")
      .single();

    if (error) {
      warnOnce(warned, "log_generation", `[DB] Failed to log generation: ${error.message}`);
      return null;
    }

    await linkMemoryMatches(data?.id, metadata.learningContext?.memoryMatches || []);
    return data?.id || null;
  }

  async function logImageAnalysis({ imageCount, imageContexts, globalPrompt, aiDescription, generationId }) {
    if (!supabase) return;

    const { error } = await supabase.from("image_analyses").insert([{
      image_count: imageCount,
      image_contexts: imageContexts || [],
      global_prompt: globalPrompt || "",
      ai_description: aiDescription || "",
      generation_id: generationId || null,
    }]);

    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "image_analyses", `[DB] Failed to log image analysis: ${error.message}`);
    }
  }

  async function logDebugSession({ originalCode, errorMessages, fixedCode, explanation }) {
    if (!supabase) return;

    const { error } = await supabase.from("debug_sessions").insert([{
      original_code: originalCode || "",
      error_messages: errorMessages || "",
      fixed_code: fixedCode || "",
      explanation: explanation || "",
    }]);

    if (error && !isMissingDbObject(error)) {
      warnOnce(warned, "debug_sessions", `[DB] Failed to log debug session: ${error.message}`);
    }
  }

  function defaultFeedbackWeight(signal, rating) {
    if (Number.isFinite(Number(rating))) return (Number(rating) - 3) * 0.04;

    return {
      copied: 0.04,
      helpful: 0.08,
      debug_requested: -0.03,
      compile_error: -0.08,
      needs_fix: -0.08,
      bad: -0.12,
    }[signal] ?? 0;
  }

  async function recordFeedback({ generationId, signal = "feedback", rating, feedback, weight }) {
    if (!supabase || !generationId) return { ok: false, skipped: true };

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

    if (!rpc.error) return { ok: true };
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

    return { ok: !event.error || isMissingDbObject(event.error) };
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

    return {
      supabaseEnabled: Boolean(supabase),
      tables,
      recentGenerations: recentGenerations.error ? [] : recentGenerations.data || [],
      topMemory: topMemory.error ? [] : topMemory.data || [],
      notes: [
        "generations stores raw prompts, extracted dimensions, output code, reasoning, and user feedback.",
        "cad_memory stores scored CAD skill records used for retrieval, promotion, demotion, and pruning.",
        "cad_generation_memory_matches links each generated result to the exact memories that influenced it.",
        "cad_feedback_events turns copy/helpful/debug signals into quality-score updates for those memories.",
      ],
    };
  }

  return {
    fetchLearningContext,
    logGeneration,
    logImageAnalysis,
    logDebugSession,
    recordFeedback,
    diagnostics,
  };
}
