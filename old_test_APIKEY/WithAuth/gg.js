import "dotenv/config";
import express from "express";
import { generateFeatureScript } from "./ai.js";
import { getAuthUrl, exchangeCodeForToken, getAccessToken } from "./auth.js";
import { postFeatureScript, getCurrentMicroversion, getPromptFromPartStudio } from "./onshape.js";

const app = express();
app.use(express.json());

const PORT    = Number(process.env.PORT || 3000);
const POLL_MS = Number(process.env.ONSHAPE_POLL_INTERVAL_MS || 4000);

// ─── State ───────────────────────────────────────────────────────────────────

let lastMicroversion    = null;
let lastProcessedPrompt = "";
let pollTimer           = null;
let pollInFlight        = false;
let generationCount     = 0;
let lastError           = "";

// Keep global in sync so onshape.js can read it when choosing between features
function setLastProcessedPrompt(p) {
  lastProcessedPrompt          = p;
  global.__lastProcessedPrompt = p; // used by getPromptFromPartStudio
}

function getIds() {
  const ids = {
    documentId:      process.env.ONSHAPE_DOC_ID,
    workspaceId:     process.env.ONSHAPE_WORKSPACE_ID,
    partStudioId:    process.env.ONSHAPE_PART_STUDIO_ID,
    outputElementId: process.env.ONSHAPE_OUTPUT_ELEMENT_ID,
  };
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing .env vars: ${missing.join(", ")}`);
  return ids;
}

// ─── Core: generate + push to Onshape ────────────────────────────────────────

async function processCadPrompt(ids, prompt) {
  console.log(`\n[AI] Generating for: "${prompt}"`);

  let fsCode;
  try {
    fsCode = await generateFeatureScript(prompt);
  } catch (err) {
    lastError = err.message;
    console.error("[AI Error]", err.message);
    return false;
  }

  try {
    await postFeatureScript(fsCode, ids);
    setLastProcessedPrompt(prompt);
    lastError = "";
    generationCount++;
    console.log(`[Bridge] ✓ Done. Generation #${generationCount}\n`);
    return true;
  } catch (err) {
    lastError = err.message;
    console.error("[Post Error]", err.message);
    return false;
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────────────

async function pollOnce() {
  if (pollInFlight || !getAccessToken()) return;
  pollInFlight = true;

  try {
    const ids = getIds();

    // 1. Fast check: did the document change at all?
    const currentMv = await getCurrentMicroversion(ids);
    if (currentMv === lastMicroversion) return;

    console.log(`[Poll] Change detected: ${lastMicroversion ?? "null"} → ${currentMv}`);
    lastMicroversion = currentMv;

    // 2. Read the prompt from the AI Architect feature dialog in the Part Studio
    const prompt = await getPromptFromPartStudio(ids);

    if (!prompt || prompt.trim().length < 3) {
      console.log("[Bridge] No prompt found in AI Architect feature — skipping.");
      return;
    }

    if (prompt.trim() === lastProcessedPrompt.trim()) {
      console.log(`[Bridge] Prompt unchanged ("${prompt.slice(0, 60)}") — skipping.`);
      return;
    }

    // 3. Generate FeatureScript and write to Feature Studio
    await processCadPrompt(ids, prompt.trim());

    // 4. Absorb the microversion created by our own write so we don't re-trigger
    await new Promise(r => setTimeout(r, 1500));
    lastMicroversion = await getCurrentMicroversion(ids);
    console.log(`[Poll] Write MV absorbed: ${lastMicroversion}`);

  } catch (err) {
    console.error("[Poll Error]", err.message);
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  if (pollTimer) return;
  console.log(`[Bridge] Polling every ${POLL_MS}ms...`);
  pollTimer = setInterval(pollOnce, POLL_MS);
  pollOnce(); // run immediately
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get("/login", (req, res) => res.redirect(getAuthUrl()));

app.get("/oauthRedirect", async (req, res) => {
  try {
    await exchangeCodeForToken(req.query.code);
    console.log("[Auth] ✓ Authorized with Onshape.");
    startPolling();
    res.send(`
      <h2>✅ Authorized — bridge is now polling.</h2>
      <p>Go back to Onshape. Open any <strong>AI Architect Relay</strong> feature in your Part Studio,
         edit the prompt text, and press the ✓ checkmark to confirm.</p>
      <p>The bridge will detect the change and regenerate the Feature Studio automatically.</p>
      <p><a href="/status">/status</a> &nbsp;|&nbsp; <a href="/trigger">/trigger</a></p>
    `);
  } catch (err) {
    res.status(500).send(`<pre>Auth error: ${err.message}</pre>`);
  }
});

app.get("/status", (req, res) => {
  res.json({
    authorized:          !!getAccessToken(),
    polling:             !!pollTimer,
    pollIntervalMs:      POLL_MS,
    generationCount,
    lastMicroversion:    lastMicroversion ?? "(none)",
    lastProcessedPrompt: lastProcessedPrompt || "(none)",
    lastError:           lastError || null,
    env: {
      partStudioId:   process.env.ONSHAPE_PART_STUDIO_ID    || "⚠ not set",
      outputStudioId: process.env.ONSHAPE_OUTPUT_ELEMENT_ID || "⚠ not set",
    }
  });
});

// Force a generation run (useful for testing without changing the document)
app.get("/trigger", async (req, res) => {
  if (!getAccessToken()) return res.status(401).json({ error: "Not authorized. Visit /login." });
  try {
    const ids = getIds();
    const prompt = await getPromptFromPartStudio(ids);
    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({
        error: "No prompt found in Part Studio. Make sure ONSHAPE_PART_STUDIO_ID is set and the AI Architect Relay feature has a prompt typed in."
      });
    }
    const force = req.query.force === "true";
    if (!force && prompt.trim() === lastProcessedPrompt.trim()) {
      return res.json({ skipped: true, reason: "Prompt unchanged. Add ?force=true to override.", prompt });
    }
    const ok = await processCadPrompt(ids, prompt.trim());
    res.json({ ok, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 CAD AI Bridge on http://localhost:${PORT}/login`);
  console.log(`   /login              — authorize with Onshape (required first)`);
  console.log(`   /status             — JSON status`);
  console.log(`   /trigger            — force run with current prompt`);
  console.log(`   /trigger?force=true — force even if prompt unchanged`);
  console.log(`\n   Part Studio (prompt source) : ${process.env.ONSHAPE_PART_STUDIO_ID ?? "⚠ ONSHAPE_PART_STUDIO_ID not set"}`);
  console.log(`   Feature Studio (code output): ${process.env.ONSHAPE_OUTPUT_ELEMENT_ID ?? "⚠ ONSHAPE_OUTPUT_ELEMENT_ID not set"}\n`);
});