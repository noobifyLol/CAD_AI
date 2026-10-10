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
   `GROQ_API_KEY2`..`9` for rotation). Supabase keys are optional. Without
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

1. **Dimension extraction:** a fast model parses the prompt into shape +
   dimensions (`extractDims` in [ai.js](ai.js)).
2. **Retrieval:** the prompt is matched against local knowledge rows,
   Omni-CAD caption summaries ([data/cadDatasetSummaries.json](data/cadDatasetSummaries.json),
   [data/captionGeometryPairs.json](data/captionGeometryPairs.json)), indexed
   FeatureScript docs ([docs/fs_reference/](docs/fs_reference/)), and one
   compile-verified code example from [data/fs_examples/](data/fs_examples/).
3. **Generate → Test → Fix loop:** up to 3 candidates; each is sanitized and
   validated locally, and any blocking errors are fed back into the next
   attempt (`runGenerateTestFixLoop`). Truncated responses are auto-closed and
   recovered instead of discarded.
4. **Repair / recovery / fallback:** failing candidates go through an AI
   repair pass; if everything fails, `buildGuaranteedFeatureScript` returns a
   deterministic parametric part so the user never gets nothing.

## DeepCAD generator (Text2CAD on Hugging Face)

The second generator gets geometry from a model trained on the **DeepCAD** dataset
instead of having an LLM write FeatureScript:

```
prompt ─► Text2CAD (Hugging Face Space, hf_space/) ─► sketch + extrude sequence
       ─► deepcadCompiler.js ─► FeatureScript 2931 ─► verification (validator + live Onshape)
```

- **Exact shapes.** Text2CAD predicts every sketch plane, line/arc/circle loop and
  extrude depth. The compiler reproduces them exactly (same conventions as
  Text2CAD's CadSeqProc), plus one editable *Overall Size* parameter.
- **Always valid code.** No model-written text reaches the FeatureScript, so syntax
  errors are impossible.
- **Verified on the website.** Every result shows whether it passed the static
  validator. With Onshape API keys set, it is also run in a real Onshape Part Studio
  (*Verify in Onshape* button, `POST /verify`).
- **Imports.** Paste DeepCAD `cad_json` files, Text2CAD minimal JSON, or
  `cad-sequence/v1` into *Import a DeepCAD / Text2CAD JSON* to compile them directly.

**DeepCAD part library.** Auto first searches 30,000 real DeepCAD parts
([data/deepcad_library.json.gz](data/deepcad_library.json.gz), built from the Text2CAD
descriptions by [scripts/deepcad_library/](scripts/deepcad_library/)) and, when one matches the
prompt's main noun, counts and features, compiles it to FeatureScript instantly and for free
(curved sketches included). True 3D shapes (cones, bottles, springs) go to Parametric AI.
Rebuild with `download.py`, `extract.py`, then `node scripts/deepcad_library/build.mjs compile`
and `select`. Data license: CC BY-NC-SA 4.0 (non-commercial).

Setup: the Text2CAD weights are gated, so first accept the terms at
https://huggingface.co/datasets/SadilKhan/Text2CAD and create a read token (`HF_TOKEN`).
Then either deploy [hf_space/](hf_space/README.md) on Modal's free monthly credits
(`npm run deepcad:modal-secret`, `npm run deepcad:deploy`), or run it on this computer
with `npm run deepcad:serve` (see "Run it locally" there). Finally set
`DEEPCAD_MODEL_URL` (and `DEEPCAD_MODEL_TOKEN`). The default **Auto** generator sends
flat, extruded parts to the model, checks the result against the prompt, and uses
Parametric AI for everything else, or with a warning when the model is unavailable.
Text2CAD only makes sketch + extrude parts. Revolves, lofts, sweeps, fillets and
patterns-as-features belong to the parametric generator. Text2CAD's license is
CC BY-NC-SA 4.0 (non-commercial).

| Endpoint | Body | Does |
| --- | --- | --- |
| `POST /generate-deepcad` | `{ prompt }` or `{ sequence }` | Model (or supplied sequence) → FeatureScript + `verification` |
| `POST /verify` | `{ code }` | Static validator + live Onshape run → `verdict` |

## Repository layout

| Path | Purpose |
| --- | --- |
| [ai.js](ai.js) | Core pipeline: prompts, generation loop, sanitizer, validator, fallbacks |
| [server.js](server.js) | Express API entry point (`npm start`) |
| [learning.js](learning.js) | Retrieval, FS-doc indexing, Supabase memory, adaptive reranker |
| [adaptiveNetwork.js](adaptiveNetwork.js) | Small neural reranker used by learning.js |
| [Auth.js](Auth.js) | Auth middleware + Supabase auth routes |
| [deepcadCompiler.js](deepcadCompiler.js) | DeepCAD / Text2CAD / `cad-sequence/v1` → FeatureScript compiler |
| [deepcadService.js](deepcadService.js) | Calls the Text2CAD Space, compiles, verifies (`/generate-deepcad`, `/verify`) |
| [hf_space/](hf_space/) | Hugging Face Docker Space serving Text2CAD |
| [data/deepcad_fixtures/](data/deepcad_fixtures/) | DeepCAD, Text2CAD and decoded-model fixtures used by the tests |
| [data/fs_examples/](data/fs_examples/) | **Compile-verified FeatureScript examples** injected into prompts; [manifest.json](data/fs_examples/manifest.json) maps keywords → example |
| [data/](data/) | Knowledge rows, dataset summaries, caption pairs, failure corpus |
| [docs/fs_reference/](docs/fs_reference/) | FeatureScript documentation indexed at server start |
| [docs/research_summaries/](docs/research_summaries/) | Research-note context loaded into prompts |
| [scripts/](scripts/) | Test, import, and extraction utilities |
| [public/](public/) | Web UI served by the Express server |
| [supabase/](supabase/) | Database migrations |

## Deploying to the cloud

The app runs anywhere Node 22 runs. It boots and serves FeatureScript even with
no API keys: generation falls back to the compile-verified curated examples and
the deterministic builders. Add `GROQ_API_KEY` to turn on AI generation.

- **Render (one click):** Render dashboard → *New* → *Blueprint* → pick this repo.
  [render.yaml](render.yaml) sets the build and start commands, the `/health`
  check, and an auto-generated `JWT_SECRET`, and prompts you for the secret keys.
- **Any container host** (Railway, Fly.io, Google Cloud Run, a VPS):
  ```bash
  docker build -t cad-ai .
  docker run -p 10000:10000 -e GROQ_API_KEY=... cad-ai
  ```
- **CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the validator
  and plan-compiler regressions on every push. It also boots the server with no
  keys and checks that `/generate` returns FeatureScript.
- **GPU model (optional):** see [model_service/README.md](model_service/README.md)
  to deploy CADFS-2B on Modal, then set `CADFS_MODEL_URL`.

## FeatureScript submission packet

[CAD_AI_FeatureScript_Submission.pdf](CAD_AI_FeatureScript_Submission.pdf) documents
the custom feature library for submission: a feature catalog, Onshape install
steps, validation results and the full source of every feature. To regenerate it
after you change the library:

```bash
python scripts/build_submission_pdf.py --author "Your Name"
```

## Tests

| Command | What it does |
| --- | --- |
| `npm run test:validator` | Offline regression: templates/examples must validate clean; known-bad code must be flagged. **Run after touching the sanitizer, validator, or examples.** |
| `npm run test:deepcad` | Offline: DeepCAD/Text2CAD/v1 sequences compile to valid FeatureScript; bad sequences are rejected |
| `npm run test:deepcad-e2e` | Offline: the website's calls (`/generate-deepcad`, `/verify`, JSON import) against a stand-in model service |
| `npm run test:deepcad-live` | Real Text2CAD model (start it with `npm run deepcad:serve`): 8 prompts through the model, the compiler and live Onshape |
| `npm run model:check` | Real CADFS-2B model (start it with `npm run model:serve`): one generation, checks it looks like FeatureScript |
| `npm run test:e2e -- "prompt"` | Full pipeline against real Groq keys; prints generation mode, validation status, and the code |
| `npm run test:guaranteed` | Checks the deterministic fallback produces valid FeatureScript |

## Adding knowledge (the main way to improve output quality)

1. Write a new example in `data/fs_examples/<name>.fs`: a complete FeatureScript
   2931 file, one exported `defineFeature`, editable `precondition` parameters.
2. Add an entry to `data/fs_examples/manifest.json` with the keywords a user
   prompt would contain.
3. Run `npm run test:validator`. The example must validate clean with zero
   sanitizer changes before it ships.

Good sources for new examples: your own generations that compiled correctly in
Onshape, and the official [FeatureScript library reference](https://cad.onshape.com/FsDoc/library.html).

## Key FeatureScript gotchas encoded in this project

- Patterns use `opPattern` + `rotationAround`/`transform` arrays;
  `opPatternCircular`/`opPatternLinear` **do not exist**.
- String concatenation is `~`, not `+`. Arrays grow with `append()`, have no `.length`.
- `isLength` parameters already carry units, so never multiply by `* inch` in the body.
- Holes = same-sketch inner circles (`qSketchRegion(id, true)`) or extrude +
  `opBoolean` SUBTRACTION.
- Named everyday objects must be decomposed into components (pen = barrel +
  tip + clip), never one stretched primitive.

## Environment knobs (.env)

- `GROQ_GENERATION_MODEL` / `GROQ_MODEL` / `GROQ_FALLBACK_MODEL`: model routing;
  free-tier TPM limits are handled by automatic completion-budget shrinking and
  key rotation in `chat()`.
- `USE_VALIDATED_TEMPLATES=true`: keep enabled; injects the validated
  structural template directive.
- `CAD_CANDIDATE_COUNT`, `CAD_REPAIR_ATTEMPTS`: loop sizing.
