import axios from "axios";
import { getAccessToken } from "./auth.js";

const BASE = "https://cad.onshape.com";

async function onshapeRequest(method, path, data = null) {
  const token = getAccessToken();
  if (!token) throw new Error("Not authorized. Visit /login first.");

  const url = `${BASE}${path}`;
  console.log(`[API] ${method.toUpperCase()} ${url}`);

  try {
    const res = await axios({
      method: method.toUpperCase(),
      url,
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json;charset=UTF-8;qs=0.09",
        "Content-Type": "application/json",
      },
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const body = JSON.stringify(err.response?.data ?? {});
    console.error(`[Onshape Error] HTTP ${status} at ${path}: ${body}`);
    throw err;
  }
}

// ─── Unwrap feature object ────────────────────────────────────────────────────
// Onshape API shape: { type, typeName, message: { featureType, name, parameters } }

function normaliseFeature(raw) {
  if (raw?.message) return raw.message; // current API
  if (raw?.feature) return raw.feature; // older API
  return raw;                           // flat fallback
}

// ─── Read prompt from Part Studio AI Architect feature ────────────────────────

export async function getPromptFromPartStudio(ids) {
  const path = `/api/partstudios/d/${ids.documentId}/w/${ids.workspaceId}/e/${ids.partStudioId}/features`;

  let data;
  try {
    data = await onshapeRequest("GET", path);
  } catch (err) {
    console.error("[Bridge] Could not read Part Studio features:", err.message);
    return "";
  }

  const rawFeatures = data.features ?? [];

  if (rawFeatures.length > 0) {
    const s = rawFeatures[0];
    console.log("[Bridge] RAW first feature keys:", Object.keys(s).join(", "));
  }

  const features = rawFeatures.map(normaliseFeature);

  const AI_NAMES = ["aiarchitectrelay", "aiarchitect", "airelay", "ai_relay", "ai_architect"];

  const aiFeatures = features.filter(f => {
    const type = (f.featureType ?? "").toLowerCase().replace(/[\s_-]/g, "");
    const name = (f.name ?? "").toLowerCase().replace(/[\s_-]/g, "");
    return AI_NAMES.some(n => type.includes(n) || name.includes(n));
  });

  if (!aiFeatures.length) {
    const allNames = features
      .map(f => `"${f.name ?? "(no name)"}" (type: ${f.featureType ?? "(no type)"})`)
      .join(", ");
    console.log(`[Bridge] No AI features found. Part Studio has: ${allNames || "(empty)"}`);
    return "";
  }

  console.log(`[Bridge] Found ${aiFeatures.length} AI feature(s): ${aiFeatures.map(f => f.name).join(", ")}`);

  // Pick one whose prompt we haven't processed yet; fall back to last
  let chosen = aiFeatures[aiFeatures.length - 1];
  for (const f of aiFeatures) {
    const p = extractStringParam(f);
    if (p && p.trim() !== (global.__lastProcessedPrompt ?? "").trim()) {
      chosen = f;
      break;
    }
  }

  const prompt = extractStringParam(chosen);
  if (prompt) {
    console.log(`[Bridge] Prompt from "${chosen.name}": "${prompt}"`);
  } else {
    console.log(`[Bridge] Feature found but no string param. Dump:`, JSON.stringify(chosen.parameters ?? [], null, 2));
  }

  return prompt;
}

function extractStringParam(feature) {
  const params = feature?.parameters ?? [];

  for (const p of params) {
    const typeName = String(p.typeName ?? "").toLowerCase();
    const btType   = String(p.btType   ?? "").toLowerCase();
    const typeNum  = String(p.type     ?? "");

    const isString =
      typeName.includes("parameterstring") ||
      btType.includes("parameterstring")   ||
      btType.includes("string-149")        ||
      typeNum === "149";

    if (isString) {
      // Value is inside p.message.value (new API) or p.value (old API)
      const val = String(p.message?.value ?? p.value ?? p.stringValue ?? "").trim();
      if (val.length > 0) return val;
    }
  }

  // Fallback: any value that looks like a natural-language sentence
  for (const p of params) {
    const val = String(p.message?.value ?? p.value ?? "").trim();
    if (val.length > 6 && val.includes(" ")) return val;
  }

  return "";
}

// ─── Write generated FeatureScript to the output Feature Studio ───────────────
//
// TWO-STEP WRITE to guarantee no old content survives:
//   Step 1 → POST a minimal stub  (clears the file)
//   Step 2 → POST the real code   (writes fresh content)
//
// Onshape's Feature Studio POST fully replaces the file each time.
// Step 1 ensures nothing from a previous run lingers if step 2 ever fails.

const CLEAR_STUB = `FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\n// Generating — please wait...\n`;

export async function postFeatureScript(featureScript, ids) {
  const path = `/api/featurestudios/d/${ids.documentId}/w/${ids.workspaceId}/e/${ids.outputElementId}`;

  // ── Step 1: clear ──
  try {
    await onshapeRequest("POST", path, { contents: CLEAR_STUB });
    console.log("[Bridge] Feature Studio cleared ✓");
    await new Promise(r => setTimeout(r, 600));
  } catch (err) {
    console.warn("[Bridge] Clear step failed (non-fatal):", err.message);
  }

  // ── Step 2: write real code ──
  const result = await onshapeRequest("POST", path, { contents: featureScript });
  console.log("[Bridge] Feature Studio written ✓");

  // ── Step 3: verify ──
  try {
    const check = await onshapeRequest("GET", path);
    const written = (check.contents ?? "").trim();
    const exports = (written.match(/\bexport const\b/g) || []).length;
    if (exports !== 1) {
      console.error(`[Bridge] ⚠ Verification: expected 1 export const, found ${exports}`);
    } else {
      console.log(`[Bridge] Verified: ${written.length} chars, 1 export const ✓`);
    }
  } catch (_) { /* non-fatal */ }

  return result;
}

// ─── Microversion detection ───────────────────────────────────────────────────

export async function getCurrentMicroversion(ids) {
  const path = `/api/documents/d/${ids.documentId}/w/${ids.workspaceId}/currentmicroversion`;
  const res = await onshapeRequest("GET", path);
  return res.microversionId ?? res.microversion ?? res.serializationId;
}