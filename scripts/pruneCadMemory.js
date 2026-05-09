import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set to prune CAD memory.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  const { data, error } = await supabase.rpc("prune_cad_memory");
  if (error) throw error;
  console.log(`[Prune] Deactivated ${Number(data || 0)} CAD memory record(s).`);
}

run().catch(err => {
  console.error("[Prune] Failed:", err.message || err);
  process.exit(1);
});
