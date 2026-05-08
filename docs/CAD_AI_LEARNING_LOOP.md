# CAD AI Learning Loop

This app does not change Groq/Llama model weights in real time. Hosted LLM weights stay fixed. The app learns by saving useful CAD lessons in Supabase, giving those lessons quality scores, retrieving the best matches before the next generation, and feeding that database context into the AI prompt.

## What Each File Does

- `server.js` is the API server. Browser requests hit `/generate`, `/debug`, `/analyze-multi`, `/feedback`, `/learning/analyze`, and `/learning/diagnostics` here.
- `AI.js` talks to Groq. It extracts dimensions, chooses a validated template or custom FeatureScript path, fixes FeatureScript, analyzes images, and runs the learning auditor.
- `learning.js` talks to Supabase. It fetches memory before generation, logs generations, logs debug/image sessions, records feedback weights, reads diagnostics, and saves AI-created memory lessons.
- `public/index.html` is the browser UI structure and styles.
- `public/script.js` is the browser logic. It calls the server, shows the timestamped result popup, sends Good/Needs Work feedback, and displays database diagnostics.
- `data/cadKnowledge.json` is the local seed knowledge used even when Supabase memory is missing.
- `scripts/seedCadKnowledge.js` copies `data/cadKnowledge.json` into Supabase `cad_knowledge` and `cad_memory`.
- `scripts/dbLearningReport.js` prints the database health report from the terminal.
- `supabase/migrations/20260505213000_adaptive_cad_memory.sql` creates the full database schema for generations, CAD knowledge, memory rows, feedback events, and scoring RPCs.

## Exact Code That Makes The AI Read The Database

In `server.js`, each generation starts by fetching memory:

```js
const learningContext = await learning.fetchLearningContext(prompt);
const result = await generateFeatureScript(prompt, { learningContext });
```

In `AI.js`, that memory is inserted into the model prompt:

```js
function withLearningContext(basePrompt, learningContext) {
  const learningText = buildLearningContextText(learningContext);
  if (!learningText) return basePrompt;
  return `${basePrompt}\n\nDATABASE CONTEXT\n${learningText}`;
}
```

That is the important learning bridge: Supabase rows become compact `DATABASE CONTEXT`, then the AI uses that context when extracting dimensions, choosing modeling strategy, debugging FeatureScript, or auditing an outcome.

## What The Weights Mean

`cad_memory.quality_score` is the app's learning weight. A higher score means the memory row is more likely to be retrieved and shown to the AI next time.

Feedback changes weights in `learning.js`:

```js
copied: 0.04
good: 0.08
helpful: 0.08
debug_requested: -0.03
compile_error: -0.08
needs_fix: -0.08
bad: -0.12
```

The SQL RPC `record_cad_feedback` applies those weights to every memory row linked to the generation. Good results promote the memories that helped. Bad results demote them and the new `/learning/analyze` endpoint can save a new failure lesson.

## Database Setup

Run this SQL once in the Supabase SQL editor:

```text
supabase/migrations/20260505213000_adaptive_cad_memory.sql
```

Then seed the starting CAD memory:

```bash
npm run seed:knowledge
```

Check that every table exists:

```bash
npm run db:learning-report
```

You can also open the app, go to `Guide`, and click `Check Database`.

## Current Learning Flow

1. Browser calls `/generate` with the user prompt.
2. `learning.fetchLearningContext(prompt)` searches `cad_memory`, `cad_knowledge`, `shape_knowledge`, and good prior `generations`.
3. `AI.js` adds that context to the AI prompt.
4. The generated FeatureScript is saved in `generations` with a timestamp.
5. The popup shows success/failure, timestamp, database save status, memory count, and example count.
6. User clicks `Good Result` or `Needs Work`.
7. Browser calls `/learning/analyze`.
8. Server records weighted feedback, asks the AI to audit the database snapshot, and upserts a new `cad_memory` lesson.
9. Future generations can retrieve that lesson and use it as context.

## Next Steps

1. Apply the migration and run `npm run seed:knowledge`.
2. Generate one simple known part, such as `box 2 x 2 x 1 inch`, then verify a row appears in `generations`.
3. Click `Good Result`; verify `cad_feedback_events` gets a row and `cad_memory` has quality scores.
4. Paste an Onshape compile error into Debug; verify `debug_sessions` gets a row and the original generation receives negative feedback.
5. Add more seed memories for advanced categories: robot mech assemblies, scissors, frames, vacuum cleaner bodies, computer/speaker housings, rocks/freeform shapes, and artwork reliefs.
6. Expand the validated template set. `ROBOT_MECH` now exists for blocky cuboid mechs; the next best templates are ball/sphere, football ellipsoid, picture frame, hinged scissors, lined-paper relief, tabletop vacuum shell, computer tower, and speaker enclosure.
7. Add a FeatureScript validation step before returning code. The best next implementation is a static checker that rejects known invalid APIs, duplicate exports, missing `skSolve`, invalid `isLength`, bad query regions, and unsafe fillet radii.
