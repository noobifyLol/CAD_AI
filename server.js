import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { analyzeImage, analyzeImages, debugFeatureScript, generateFeatureScript } from "./ai.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const localCadKnowledge = JSON.parse(
  readFileSync(new URL("./data/cadKnowledge.json", import.meta.url), "utf8")
);

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

if (!supabase) {
  console.warn("[DB] Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable learning/logging.");
}

function extractKeywords(prompt, limit = 5) {
  const stopWords = new Set([
    "the", "and", "for", "with", "that", "this", "make", "build", "create", "using",
    "part", "model", "feature", "featurescript", "inch", "inches", "from", "into"
  ]);

  const words = String(prompt || "").toLowerCase().match(/[a-z0-9_]+/g) || [];
  return [...new Set(words.filter(word => word.length > 2 && !stopWords.has(word)))].slice(0, limit);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function scoreKnowledgeEntry(prompt, entry) {
  const haystack = [
    entry.title,
    entry.summary,
    ...(entry.tags || []),
    ...(entry.keywords || []),
    ...(entry.parameterHints || []),
    ...(entry.modelingNotes || []),
  ].join(" ").toLowerCase();

  return extractKeywords(prompt, 8).reduce((score, keyword) => {
    if (haystack.includes(keyword)) return score + 1;
    return score;
  }, 0);
}

function getLocalKnowledge(prompt, limit = 3) {
  if (!prompt) return [];

  return [...localCadKnowledge]
    .map(entry => ({ ...entry, score: scoreKnowledgeEntry(prompt, entry) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...entry }) => entry);
}

async function fetchLearningContext(prompt) {
  const learningContext = {
    prompt,
    examples: [],
    notes: [],
    knowledge: getLocalKnowledge(prompt),
  };

  if (!supabase || !prompt) return learningContext;

  const keywords = extractKeywords(prompt);
  let query = supabase
    .from("generations")
    .select("prompt, shape_type, confidence, dims, featurescript, thinking")
    .limit(6);

  if (keywords.length) {
    const filters = keywords
      .flatMap(keyword => [`prompt.ilike.%${keyword}%`, `shape_type.ilike.%${keyword}%`])
      .join(",");
    query = query.or(filters);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[DB] Could not load learning examples:", error.message);
    return learningContext;
  }

  learningContext.examples = Array.isArray(data) ? data.filter(Boolean).slice(0, 3) : [];

  const shapes = [...new Set(learningContext.examples.map(example => example.shape_type).filter(Boolean))];
  if (shapes.length) {
    learningContext.notes.push(`Recent related shapes in the project database: ${shapes.join(", ")}.`);
  }

  const reasoningHints = learningContext.examples
    .map(example => String(example.thinking || "").split("\n")[0].trim())
    .filter(Boolean)
    .slice(0, 2);

  if (reasoningHints.length) {
    learningContext.notes.push(`Prior reasoning patterns: ${reasoningHints.join(" | ")}`);
  }

  if (learningContext.knowledge.length) {
    learningContext.notes.push(`Matched ${learningContext.knowledge.length} CAD knowledge record(s) for this request.`);
  }

  if (supabase) {
    const knowledgeTerms = extractKeywords(prompt, 4);
    let knowledgeQuery = supabase
      .from("cad_knowledge")
      .select("title, summary, tags, keywords, parameter_hints, modeling_notes, example_prompt")
      .limit(5);

    if (knowledgeTerms.length) {
      const knowledgeFilters = knowledgeTerms
        .map(keyword => `keywords.cs.{${keyword}},tags.cs.{${keyword}},title.ilike.%${keyword}%`)
        .join(",");
      knowledgeQuery = knowledgeQuery.or(knowledgeFilters);
    }

    const { data: knowledgeRows, error: knowledgeError } = await knowledgeQuery;
    if (knowledgeError) {
      console.warn("[DB] Could not load CAD knowledge:", knowledgeError.message);
    } else if (Array.isArray(knowledgeRows) && knowledgeRows.length) {
      learningContext.knowledge = [...learningContext.knowledge, ...knowledgeRows].slice(0, 5);
    }
  }

  return learningContext;
}

async function logGeneration(prompt, result) {
  if (!supabase) return;

  const payload = {
    prompt,
    shape_type: result?.dims?.shape || null,
    confidence: result?.dims?.confidence || null,
    dims: jsonSafe(result?.dims),
    featurescript: result?.code || "",
    thinking: result?.thinking || "",
  };

  const { error } = await supabase.from("generations").insert([payload]);
  if (error) {
    console.warn("[DB] Failed to log generation:", error.message);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    supabaseEnabled: Boolean(supabase),
  });
});

app.post("/generate", async (req, res) => {
  const prompt = String(req.body.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  try {
    const learningContext = await fetchLearningContext(prompt);
    const result = await generateFeatureScript(prompt, { learningContext });
    await logGeneration(prompt, result);
    res.json({
      code: result.code,
      featureName: result.featureName,
      featureLabel: result.featureLabel,
      thinking: result.thinking,
      generationMode: result.generationMode,
    });
  } catch (err) {
    console.error("[/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/debug", async (req, res) => {
  const code = String(req.body.code || "").trim();
  const errors = String(req.body.errors || "").trim();
  if (!code) return res.status(400).json({ error: "No FeatureScript provided." });

  try {
    const learningContext = await fetchLearningContext(`${errors}\n${code.slice(0, 400)}`);
    const { fixed, explanation } = await debugFeatureScript(code, errors, { learningContext });
    res.json({ fixed, explanation });
  } catch (err) {
    console.error("[/debug]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/analyze", async (req, res) => {
  const imageBase64 = req.body.imageBase64;
  const mimeType = req.body.mimeType || "image/jpeg";
  const prompt = String(req.body.prompt || "").trim();
  if (!imageBase64) return res.status(400).json({ error: "No image provided." });

  try {
    const learningContext = await fetchLearningContext(prompt);
    const result = await analyzeImage(imageBase64, mimeType, prompt, { learningContext });
    await logGeneration(prompt || "Image analysis", result);
    res.json(result);
  } catch (err) {
    console.error("[/analyze]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/analyze-multi", async (req, res) => {
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  const globalPrompt = String(req.body.globalPrompt || "").trim();

  if (images.length === 0) {
    return res.status(400).json({ error: "No images provided." });
  }
  if (images.some(img => !img?.imageBase64)) {
    return res.status(400).json({ error: "One or more images are missing base64 data." });
  }

  try {
    const contextualPrompt = [
      globalPrompt,
      ...images.map(img => String(img.context || "").trim()).filter(Boolean),
    ].join(" | ");

    const learningContext = await fetchLearningContext(contextualPrompt);
    const result = await analyzeImages(images, globalPrompt, { learningContext });
    await logGeneration(contextualPrompt || "Multi-image analysis", result);
    res.json(result);
  } catch (err) {
    console.error("[/analyze-multi]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
