import "dotenv/config";
import express from "express";
import { generateFeatureScript, debugFeatureScript, analyzeImage, analyzeImages } from "./ai.js";

const app  = express();
const PORT = Number(process.env.PORT || 10000);

app.use(express.json({ limit: "20mb" })); // large enough for multiple base64 images
app.use(express.static("public"));

// ── Generate FeatureScript from a text prompt ─────────────────────────────────
app.post("/generate", async (req, res) => {
  const prompt = (req.body.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "No prompt provided." });

  try {
    const { code, featureName, featureLabel, thinking } = await generateFeatureScript(prompt);
    res.json({ code, featureName, featureLabel, thinking });
  } catch (err) {
    console.error("[/generate]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Debug / fix broken FeatureScript ─────────────────────────────────────────
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

// ── Analyze a single image (legacy) ──────────────────────────────────────────
app.post("/analyze", async (req, res) => {
  const { imageBase64, mimeType, prompt } = req.body;
  if (!imageBase64) return res.status(400).json({ error: "No image provided." });

  try {
    const { description, code, featureName, featureLabel, thinking } =
      await analyzeImage(imageBase64, mimeType || "image/jpeg", prompt || "");
    res.json({ description, code, featureName, featureLabel, thinking });
  } catch (err) {
    console.error("[/analyze]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Analyze multiple images together ─────────────────────────────────────────
// Body: {
//   images: Array<{ imageBase64: string, mimeType: string, context: string }>,
//   globalPrompt: string
// }
app.post("/analyze-multi", async (req, res) => {
  const { images, globalPrompt } = req.body;
  if (!Array.isArray(images) || images.length === 0)
    return res.status(400).json({ error: "No images provided." });
  if (images.some(img => !img.imageBase64))
    return res.status(400).json({ error: "One or more images are missing base64 data." });

  try {
    const { description, code, featureName, featureLabel, thinking } =
      await analyzeImages(images, globalPrompt || "");
    res.json({ description, code, featureName, featureLabel, thinking });
  } catch (err) {
    console.error("[/analyze-multi]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 AI CAD Generator running at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser to use the tool.\n`);
});