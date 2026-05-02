import "dotenv/config";
import express from "express";
import { generateFeatureScript, debugFeatureScript, analyzeImage } from "./ai.js";

const app  = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "10mb" })); // large enough for base64 images
app.use(express.static("public"));

// ── Generate FeatureScript from a text prompt ─────────────────────────────────
app.post("/generate", async (req, res) => {
  const prompt = (req.body.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  try {
    const { code, featureName, featureLabel } = await generateFeatureScript(prompt);
    res.json({ code, featureName, featureLabel });
  } catch (err) {
    console.error("[/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Debug / fix broken FeatureScript ─────────────────────────────────────────
// Body: { code: string, errors: string }
app.post("/debug", async (req, res) => {
  const { code, errors } = req.body;
  if (!code) return res.status(400).json({ error: "No FeatureScript provided." });

  try {
    const { fixed, explanation } = await debugFeatureScript(code, errors || "");
    res.json({ fixed, explanation });
  } catch (err) {
    console.error("[/debug]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Analyze an image and generate FeatureScript from it ──────────────────────
// Body: { imageBase64: string, mimeType: string, prompt: string }
app.post("/analyze", async (req, res) => {
  const { imageBase64, mimeType, prompt } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "No image provided." });

  try {
    const { description, code, featureName, featureLabel } = await analyzeImage(imageBase64, mimeType || "image/jpeg", prompt || "");
    res.json({ description, code, featureName, featureLabel });
  } catch (err) {
    console.error("[/analyze]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 AI CAD Generator running at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser to use the tool.\n`);
});