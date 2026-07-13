# CAD_AI

CAD_AI turns natural-language prompts ("create a wheel with 6 spokes") into
[Onshape FeatureScript](https://cad.onshape.com/FsDoc/) that compiles and
produces editable parametric geometry. It uses Groq-hosted models with
retrieval grounding, a generate → test → fix loop, and deterministic fallbacks
so a request always returns usable FeatureScript.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` with at least one Groq API key (`GROQ_API_KEY`, optionally
   `GROQ_API_KEY2`..`9` for rotation). Supabase keys are optional — without
   them the app runs on local knowledge files only.
3. Start the server:
   ```bash
   npm start
   ```
4. Or test generation directly from the command line (no server needed):
   ```bash
   npm run test:e2e -- "Create a coffee mug with a handle"
   ```

## How a generation works

1. **Dimension extraction** — a fast model parses the prompt into shape +
   dimensions (`extractDims` in [ai.js](ai.js)).
2. **Retrieval** — the prompt is matched against local knowledge rows,
   Omni-CAD caption summaries ([data/cadDatasetSummaries.json](data/cadDatasetSummaries.json),
   [data/captionGeometryPairs.json](data/captionGeometryPairs.json)), indexed
   FeatureScript docs ([docs/fs_reference/](docs/fs_reference/)), and one
   compile-verified code example from [data/fs_examples/](data/fs_examples/).
3. **Generate → Test → Fix loop** — up to 3 candidates; each is sanitized and
   validated locally, and any blocking errors are fed back into the next
   attempt (`runGenerateTestFixLoop`). Truncated responses are auto-closed and
   recovered instead of discarded.
4. **Repair / recovery / fallback** — failing candidates go through an AI
   repair pass; if everything fails, `buildGuaranteedFeatureScript` returns a
   deterministic parametric part so the user never gets nothing.

## Repository layout

| Path | Purpose |
| --- | --- |
| [ai.js](ai.js) | Core pipeline: prompts, generation loop, sanitizer, validator, fallbacks |
| [server.js](server.js) | Express API entry point (`npm start`) |
| [learning.js](learning.js) | Retrieval, FS-doc indexing, Supabase memory, adaptive reranker |
| [adaptiveNetwork.js](adaptiveNetwork.js) | Small neural reranker used by learning.js |
| [Auth.js](Auth.js) | Auth middleware + Supabase auth routes |
| [data/fs_examples/](data/fs_examples/) | **Compile-verified FeatureScript examples** injected into prompts; [manifest.json](data/fs_examples/manifest.json) maps keywords → example |
| [data/](data/) | Knowledge rows, dataset summaries, caption pairs, failure corpus |
| [docs/fs_reference/](docs/fs_reference/) | FeatureScript documentation indexed at server start |
| [docs/research_summaries/](docs/research_summaries/) | Research-note context loaded into prompts |
| [scripts/](scripts/) | Test, import, and extraction utilities |
| [public/](public/) | Web UI served by the Express server |
| [supabase/](supabase/) | Database migrations |

## Tests

| Command | What it does |
| --- | --- |
| `npm run test:validator` | Offline regression: templates/examples must validate clean; known-bad code must be flagged. **Run after touching the sanitizer, validator, or examples.** |
| `npm run test:e2e -- "prompt"` | Full pipeline against real Groq keys; prints generation mode, validation status, and the code |
| `npm run test:guaranteed` | Checks the deterministic fallback produces valid FeatureScript |

## Adding knowledge (the main way to improve output quality)

1. Write a new example in `data/fs_examples/<name>.fs` — complete FeatureScript
   2931 file, one exported `defineFeature`, editable `precondition` parameters.
2. Add an entry to `data/fs_examples/manifest.json` with the keywords a user
   prompt would contain.
3. Run `npm run test:validator` — the example must validate clean with zero
   sanitizer changes before it ships.

Good sources for new examples: your own generations that compiled correctly in
Onshape, and the official [FeatureScript library reference](https://cad.onshape.com/FsDoc/library.html).

## Key FeatureScript gotchas encoded in this project

- Patterns use `opPattern` + `rotationAround`/`transform` arrays —
  `opPatternCircular`/`opPatternLinear` **do not exist**.
- String concatenation is `~`, not `+`. Arrays grow with `append()`, have no `.length`.
- `isLength` parameters already carry units — never multiply by `* inch` in the body.
- Holes = same-sketch inner circles (`qSketchRegion(id, true)`) or extrude +
  `opBoolean` SUBTRACTION.
- Named everyday objects must be decomposed into components (pen = barrel +
  tip + clip), never one stretched primitive.

## Environment knobs (.env)

- `GROQ_GENERATION_MODEL` / `GROQ_MODEL` / `GROQ_FALLBACK_MODEL` — model routing;
  free-tier TPM limits are handled by automatic completion-budget shrinking and
  key rotation in `chat()`.
- `USE_VALIDATED_TEMPLATES=true` — keep enabled; injects the validated
  structural template directive.
- `CAD_CANDIDATE_COUNT`, `CAD_REPAIR_ATTEMPTS` — loop sizing.
