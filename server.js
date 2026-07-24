import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import {
  analyzeImage,
  analyzeImages,
  analyzeLearningOutcome,
  debugFeatureScript,
  generateFeatureScript,
  getModelConfig,
} from "./ai.js";
import { authMiddleware, createAuthRouter, requireAuth } from "./Auth.js";
import { createLearningService } from "./learning.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;
const supabaseKeyMode = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  ? "service_role"
  : (process.env.SUPABASE_ANON_KEY ? "anon" : "missing");
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const learning = createLearningService({
  supabase,
  cadKnowledgePath: new URL("./data/cadKnowledge.json", import.meta.url),
  cadKnowledgeCsvPath: new URL("./data/cadKnowledge.csv", import.meta.url),
  cadPruningPath: new URL("./data/cadPruningTable.csv", import.meta.url),
  fsDocsPath: new URL("./docs/fs_reference/", import.meta.url),
});
const authRoutes = createAuthRouter(supabase);

app.use(express.json({ limit: "20mb" }));
app.use(authMiddleware);
app.use(express.static("public"));

if (!supabase) {
  console.warn("[DB] Supabase is disabled. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable adaptive memory.");
}

function truncateForLog(text, max = 2000) {
  const normalized = typeof text === "string" ? text : JSON.stringify(text);
  return normalized.length > max ? `${normalized.slice(0, max)}...<truncated>` : normalized;
}

function normalizeDbLog(log) {
  if (typeof log === "string") {
    return { id: log, ok: true, createdAt: new Date().toISOString() };
  }
  return log || { id: null, ok: false, skipped: true, createdAt: new Date().toISOString() };
}

function generationResponse(result, generationLog, learningContext, diagnostics = null) {
  const dbLog = normalizeDbLog(generationLog);
  return {
    code: result.code,
    featureName: result.featureName,
    featureLabel: result.featureLabel,
    description: result.description,
    thinking: result.thinking,
    generationMode: result.generationMode,
    completionLevel: result.completionLevel,
    warnings: result.warnings || [],
    omissions: result.omissions || [],
    orchestration: result.orchestration || null,
    generationId: dbLog.id || null,
    createdAt: dbLog.createdAt,
    database: {
      ok: Boolean(dbLog.ok),
      skipped: Boolean(dbLog.skipped),
      table: dbLog.table || "generations",
      action: dbLog.action || "insert",
      error: dbLog.error || null,
      code: dbLog.code || null,
      schemaReady: diagnostics?.schemaReady ?? null,
      missingAdaptiveTables: diagnostics?.missingAdaptiveTables || [],
    },
    learning: {
      examples: learningContext.examples.length,
      memories: learningContext.memoryMatches.length,
      docs: learningContext.featureScriptDocs?.length || 0,
      schemaReady: diagnostics?.schemaReady ?? null,
      adaptiveNetwork: learningContext.adaptiveNetwork || null,
      shapeHint: learningContext.shapeHint,
    },
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    supabaseEnabled: Boolean(supabase),
    supabaseKeyMode,
    models: getModelConfig(),
  });
});

app.post("/auth/signup", authRoutes.signup);
app.post("/auth/login", authRoutes.login);
app.get("/auth/me", authRoutes.me);

app.get("/history", requireAuth, async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: "Database not configured." });
  }

  const requestedLimit = Number(req.query.limit || 30);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.round(requestedLimit)))
    : 30;

  try {
    const rpc = await supabase.rpc("get_user_history", {
      p_user_id: req.user.id,
      p_limit: limit,
    });

    if (!rpc.error) {
      return res.json({ history: rpc.data || [] });
    }

    const fallback = await supabase
      .from("generations")
      .select("id,prompt,shape_type,confidence,featurescript,user_rating,created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (fallback.error) {
      throw fallback.error;
    }

    res.json({ history: fallback.data || [] });
  } catch (err) {
    console.error("[/history]", err.message);
    res.status(500).json({ error: err.message });
  }
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
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  try {
    console.log(`[/generate] body=${truncateForLog(req.body, 2000)}`);

    // A DB hiccup fetching learning context must not block generation — FeatureScript
    // generation doesn't fundamentally need it, so degrade to an empty context instead
    // of failing the whole request before generateFeatureScript ever runs.
    let learningContext = { examples: [], memoryMatches: [], featureScriptDocs: [] };
    try {
      learningContext = await learning.fetchLearningContext(prompt, history);
    } catch (contextErr) {
      console.error("[/generate] fetchLearningContext failed, continuing without it:", contextErr.message);
    }

    const result = await generateFeatureScript(prompt, { learningContext, history });

    // generateFeatureScript is guaranteed to return usable code at this point (it has
    // its own layered fallbacks). A failure logging/reading DB state afterward must not
    // discard that result and hand the caller a bare error instead of their FeatureScript.
    let generationLog = null;
    let diagnostics = null;
    try {
      generationLog = await learning.logGeneration(prompt, result, {
        learningContext,
        userId: req.user?.id || null,
      });
      diagnostics = await learning.diagnostics();
    } catch (postErr) {
      console.error("[/generate] post-generation logging/diagnostics failed, returning result anyway:", postErr.message);
    }

    console.log(`[/generate] resultMeta=${truncateForLog({
      featureName: result.featureName,
      featureLabel: result.featureLabel,
      generationMode: result.generationMode,
      database: generationLog,
    }, 1500)}`);
    res.json(generationResponse(result, generationLog, learningContext, diagnostics));
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
    console.log(`[/debug] body=${truncateForLog({ ...req.body, code: code.slice(0, 1200) }, 2000)}`);

    let learningContext = { examples: [], memoryMatches: [], featureScriptDocs: [] };
    try {
      learningContext = await learning.fetchLearningContext(`${errors}\n${code.slice(0, 400)}`);
    } catch (contextErr) {
      console.error("[/debug] fetchLearningContext failed, continuing without it:", contextErr.message);
    }

    // debugFeatureScript always returns a usable { fixed, explanation } — it has its
    // own internal fallback to the sanitized original code. A DB logging failure below
    // must not discard that and hand the caller a bare error instead of their fix.
    const { fixed, explanation } = await debugFeatureScript(code, errors, { learningContext });

    let debugLog = null;
    try {
      debugLog = await learning.logDebugSession({
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
    } catch (logErr) {
      console.error("[/debug] logging/feedback failed, returning fix anyway:", logErr.message);
    }

    res.json({ fixed, explanation, createdAt: debugLog?.createdAt || new Date().toISOString(), database: debugLog });
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
    let learningContext = { examples: [], memoryMatches: [], featureScriptDocs: [] };
    try {
      learningContext = await learning.fetchLearningContext(prompt);
    } catch (contextErr) {
      console.error("[/analyze] fetchLearningContext failed, continuing without it:", contextErr.message);
    }

    const result = await analyzeImage(imageBase64, mimeType, prompt, { learningContext });

    // A DB logging failure after a successful analysis must not discard the result.
    let generationLog = null;
    let diagnostics = null;
    try {
      generationLog = await learning.logGeneration(prompt || "Image analysis", result, {
        learningContext,
        userId: req.user?.id || null,
      });
      const generationId = normalizeDbLog(generationLog).id;
      await learning.logImageAnalysis({
        imageCount: 1,
        imageContexts: ["Reference"],
        globalPrompt: prompt,
        aiDescription: result.description,
        generationId,
      });
      diagnostics = await learning.diagnostics();
    } catch (logErr) {
      console.error("[/analyze] post-analysis logging failed, returning result anyway:", logErr.message);
    }

    res.json(generationResponse(result, generationLog, learningContext, diagnostics));
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

    let learningContext = { examples: [], memoryMatches: [], featureScriptDocs: [] };
    try {
      learningContext = await learning.fetchLearningContext(contextualPrompt);
    } catch (contextErr) {
      console.error("[/analyze-multi] fetchLearningContext failed, continuing without it:", contextErr.message);
    }

    const result = await analyzeImages(images, globalPrompt, { learningContext });

    // A DB logging failure after a successful analysis must not discard the result.
    let generationLog = null;
    let diagnostics = null;
    try {
      generationLog = await learning.logGeneration(contextualPrompt || "Multi-image analysis", result, {
        learningContext,
        userId: req.user?.id || null,
      });
      const generationId = normalizeDbLog(generationLog).id;
      await learning.logImageAnalysis({
        imageCount: images.length,
        imageContexts,
        globalPrompt,
        aiDescription: result.description,
        generationId,
      });
      diagnostics = await learning.diagnostics();
    } catch (logErr) {
      console.error("[/analyze-multi] post-analysis logging failed, returning result anyway:", logErr.message);
    }

    res.json(generationResponse(result, generationLog, learningContext, diagnostics));
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

app.post("/learning/analyze", async (req, res) => {
  const prompt = String(req.body.prompt || "").trim();
  const generationId = String(req.body.generationId || "").trim() || null;
  const signal = String(req.body.signal || "feedback").trim();
  const feedback = String(req.body.feedback || "").trim();
  const errorMessages = String(req.body.errorMessages || "").trim();
  const rating = req.body.rating;

  if (!generationId && !prompt) {
    return res.status(400).json({ error: "Provide generationId or prompt." });
  }

  try {
    console.log(`[/learning/analyze] body=${truncateForLog(req.body, 2000)}`);
    let feedbackResult = null;
    if (generationId) {
      feedbackResult = await learning.recordFeedback({
        generationId,
        signal,
        rating,
        feedback: feedback || errorMessages || undefined,
      });
    }

    const snapshot = await learning.fetchGenerationSnapshot({ generationId, prompt });
    const analysis = await analyzeLearningOutcome({
      prompt: prompt || snapshot.generation?.prompt || "",
      signal,
      rating,
      feedback,
      errorMessages,
      snapshot,
    });
    const memory = await learning.saveLearningAnalysis({
      analysis,
      prompt: prompt || snapshot.generation?.prompt || "",
      generationId,
      signal,
      rating,
      feedback: feedback || errorMessages,
    });

    res.json({
      ok: true,
      analyzedAt: new Date().toISOString(),
      feedback: feedbackResult,
      analysis,
      memory,
      database: {
        supabaseEnabled: snapshot.supabaseEnabled,
        generationFound: Boolean(snapshot.generation),
      },
    });
  } catch (err) {
    console.error("[/learning/analyze]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] Render=${Boolean(process.env.RENDER)} SupabaseKeyMode=${supabaseKeyMode}`);
  console.log(`[Server] GroqModel=${process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"} VisionModel=${process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"}`);
});
