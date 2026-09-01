# Local CADFS-2B model service

Self-hosts [VladPyatov/CADFS-2B](https://huggingface.co/VladPyatov/CADFS-2B) — a
fine-tuned Qwen2-VL-2B (MIT) that turns a text description into FeatureScript,
trained on 450k real Onshape models. Runs locally on your GPU; no API cost.

## What it is (and isn't)

- **Is:** a natural-language → FeatureScript generator with strong dimensional
  accuracy (it gets sizes/holes/thicknesses right from plain English).
- **Isn't:** the parametric-dialog generator the main app (`/generate`) produces.
  This model emits **older-version, non-parametric reconstruction** FeatureScript
  (empty `precondition{}`, hardcoded mm). Paste its output into an Onshape
  **Feature Studio** to import; there are no editable dialog sliders.

## One-time setup

Requires an NVIDIA GPU (tested on RTX 5080, 16 GB) and Python 3.12.

```bash
python -m venv .venv
./.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu128
./.venv/Scripts/python.exe -m pip install -r model_service/requirements.txt
```

`transformers` is pinned to **4.51.3** on purpose — Qwen2-VL processor loading is
broken in transformers 5.x. The model (~5 GB) downloads automatically on first run
to your Hugging Face cache.

## Run

```bash
npm run model:serve
```

Loads the model onto the GPU (~5 s) and serves on `http://127.0.0.1:8765`:

- `GET  /health` → `{ ok, model, device }`
- `POST /generate` `{ "description": "..." }` → `{ "featurescript", "elapsedSec" }`

Typical generation is ~10–16 s on an RTX 5080.

## Use from the app

With the model server running, the Node app exposes `POST /generate-model`
`{ "prompt": "..." }`, which proxies to the model and returns its FeatureScript
tagged `generationMode: "cadfs_2b_local_model"`. This is deliberately separate
from `/generate` (the parametric 2931 pipeline) so the two don't mix.

Env: `CADFS_MODEL_URL` (default `http://127.0.0.1:8765`), `CADFS_MODEL_ID`,
`CADFS_PORT`, `CADFS_MAX_NEW_TOKENS`.

## Cloud deployment (so your PC doesn't have to stay on)

`modal_app.py` runs the same API on [Modal](https://modal.com) — a serverless GPU
that **scales to zero**: you pay per-second only while a request runs, nothing
while idle, and it's available 24/7.

```bash
./.venv/Scripts/python.exe -m pip install modal
./.venv/Scripts/python.exe -m modal setup     # opens browser, links your account
npm run model:deploy
```

Modal prints a URL like `https://<you>--cadfs-2b-web.modal.run`. Point the app at it:

```bash
# add to .env
CADFS_MODEL_URL=https://<you>--cadfs-2b-web.modal.run
```

No app code changes — `/generate-model` just uses the new URL. When it detects a
remote URL it automatically allows longer timeouts and retries once, because a
scaled-to-zero GPU has a **cold start** (~20–40 s) on the first request after
idling; subsequent requests are fast.

**Cost:** a T4 GPU is billed per-second of actual use only. Modal's free monthly
credits typically cover light personal use. The weights are baked into the
container image at build time, so cold starts don't re-download 5 GB.

## Verify either backend

```bash
npm run model:check                                        # local (or CADFS_MODEL_URL)
npm run model:check -- https://<you>--cadfs-2b-web.modal.run   # a specific deployment
```

Checks `/health`, runs a real generation, and reports timing plus whether the
output looks like valid FeatureScript.

## Other hosting options

Modal isn't the only choice — the same `cadfs_server.py` runs on any GPU box:
RunPod, Vast.ai, Lambda Labs, or a cloud VM with an NVIDIA GPU. Those are usually
billed **per hour while running** (not scale-to-zero), so they cost more for
intermittent use but avoid cold starts. Hugging Face Inference Endpoints can also
host this model directly from its repo.
