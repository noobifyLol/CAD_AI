import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADAPTIVE_NETWORK_KEY,
  createInitialAdaptiveState,
  trainAdaptiveState,
} from "../adaptiveNetwork.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputPath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(root, "data", "adaptive_training.jsonl");
const outputPath = process.env.ADAPTIVE_STATE_PATH || join(root, "data", "adaptive_state.json");

function cleanVector(value) {
  return Array.isArray(value) && value.length === 11 && value.every(v => Number.isFinite(Number(v)))
    ? value.map(Number)
    : null;
}

async function loadExistingState() {
  if (!existsSync(outputPath)) return createInitialAdaptiveState();
  try {
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    return parsed?.state || parsed || createInitialAdaptiveState();
  } catch {
    return createInitialAdaptiveState();
  }
}

async function maybeSaveSupabaseState(state) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { skipped: true, reason: "SUPABASE_URL or SUPABASE_ANON_KEY missing" };
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("cad_learning_state").upsert([{
    state_key: ADAPTIVE_NETWORK_KEY,
    state,
    updated_at: new Date().toISOString(),
  }], { onConflict: "state_key" });

  return error
    ? { skipped: false, ok: false, error: error.message, code: error.code }
    : { skipped: false, ok: true };
}

async function main() {
  if (!existsSync(inputPath)) {
    throw new Error(`Training file not found: ${inputPath}`);
  }
  const lines = (await readFile(inputPath, "utf8")).split(/\r?\n/).filter(Boolean);
  let state = await loadExistingState();
  let trained = 0;
  let skipped = 0;

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      const vector = cleanVector(item.vector);
      const target = Number(item.target);
      if (!vector || !Number.isFinite(target)) {
        skipped += 1;
        continue;
      }
      state = trainAdaptiveState(state, [vector], Math.max(0, Math.min(1, target)), 1);
      trained += 1;
    } catch {
      skipped += 1;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    state,
    trainedExamples: trained,
    skippedExamples: skipped,
    source: inputPath,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  const supabase = await maybeSaveSupabaseState(state);
  console.log(JSON.stringify({
    ok: true,
    trainedExamples: trained,
    skippedExamples: skipped,
    trainedSteps: state.trainedSteps,
    outputPath,
    supabase,
  }, null, 2));
}

main().catch(err => {
  console.error(`[train_adaptive_network] ${err.message}`);
  process.exit(1);
});
