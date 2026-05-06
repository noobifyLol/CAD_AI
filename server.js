import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { analyzeImage, analyzeImages, debugFeatureScript, generateFeatureScript } from "./AI.js";
import { createLearningService } from "./learning.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const learning = createLearningService({
  supabase,
  cadKnowledgePath: new URL("./data/cadKnowledge.json", import.meta.url),
});

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

if (!supabase) {
  console.warn("[DB] Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable adaptive memory.");
}

function generationResponse(result, generationId, learningContext) {
  return {
    code: result.code,
    featureName: result.featureName,
    featureLabel: result.featureLabel,
    description: result.description,
    thinking: result.thinking,
    generationMode: result.generationMode,
    generationId,
    learning: {
      examples: learningContext.examples.length,
      memories: learningContext.memoryMatches.length,
      shapeHint: learningContext.shapeHint,
    },
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    supabaseEnabled: Boolean(supabase),
  });
});

app.get("/learning/diagnostics", async (_req, res) => {
  try {
    res.json(await learning.diagnostics());
  } catch (err) {
    console.error("[/learning/diagnostics]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/generate", async (req, res) => {
  const prompt = String(req.body.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  try {
    const learningContext = await learning.fetchLearningContext(prompt);
    const result = await generateFeatureScript(prompt, { learningContext });
    const generationId = await learning.logGeneration(prompt, result, { learningContext });
    res.json(generationResponse(result, generationId, learningContext));
  } catch (err) {
    console.error("[/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/debug", async (req, res) => {
  const code = String(req.body.code || "").trim();
  const errors = String(req.body.errors || "").trim();
  const generationId = String(req.body.generationId || "").trim() || null;
  if (!code) return res.status(400).json({ error: "No FeatureScript provided." });

  try {
    const learningContext = await learning.fetchLearningContext(`${errors}\n${code.slice(0, 400)}`);
    const { fixed, explanation } = await debugFeatureScript(code, errors, { learningContext });

    await learning.logDebugSession({
      originalCode: code,
      errorMessages: errors,
      fixedCode: fixed,
      explanation,
    });

    if (generationId) {
      await learning.recordFeedback({
        generationId,
        signal: errors ? "compile_error" : "debug_requested",
        feedback: errors || "Sent to debug for review.",
      });
    }

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
    const learningContext = await learning.fetchLearningContext(prompt);
    const result = await analyzeImage(imageBase64, mimeType, prompt, { learningContext });
    const generationId = await learning.logGeneration(prompt || "Image analysis", result, { learningContext });

    await learning.logImageAnalysis({
      imageCount: 1,
      imageContexts: ["Reference"],
      globalPrompt: prompt,
      aiDescription: result.description,
      generationId,
    });

    res.json(generationResponse(result, generationId, learningContext));
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
    const imageContexts = images.map(img => String(img.context || "").trim()).filter(Boolean);
    const contextualPrompt = [globalPrompt, ...imageContexts].filter(Boolean).join(" | ");

    const learningContext = await learning.fetchLearningContext(contextualPrompt);
    const result = await analyzeImages(images, globalPrompt, { learningContext });
    const generationId = await learning.logGeneration(contextualPrompt || "Multi-image analysis", result, { learningContext });

    await learning.logImageAnalysis({
      imageCount: images.length,
      imageContexts,
      globalPrompt,
      aiDescription: result.description,
      generationId,
    });

    res.json(generationResponse(result, generationId, learningContext));
  } catch (err) {
    console.error("[/analyze-multi]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/feedback", async (req, res) => {
  const generationId = String(req.body.generationId || "").trim();
  if (!generationId) return res.status(400).json({ error: "No generationId provided." });

  try {
    const result = await learning.recordFeedback({
      generationId,
      signal: String(req.body.signal || "feedback"),
      rating: req.body.rating,
      feedback: req.body.feedback,
      weight: req.body.weight,
    });
    res.json(result);
  } catch (err) {
    console.error("[/feedback]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
