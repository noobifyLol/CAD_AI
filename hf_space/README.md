---
title: CAD AI Text2CAD
emoji: 🛠️
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
license: cc-by-nc-sa-4.0
short_description: Text to DeepCAD sketch/extrude sequences for CAD_AI
---

# CAD_AI Text2CAD service

This folder is a ready-to-deploy **Hugging Face Docker Space**. It runs
[Text2CAD](https://github.com/SadilKhan/Text2CAD) (NeurIPS 2024), a text-conditioned
model trained on the **DeepCAD** dataset, and returns its prediction as a
sketch + extrude sequence. The CAD_AI web app turns that sequence into FeatureScript
with a deterministic compiler (`../deepcadCompiler.js`), so the model decides the
shape and the compiler guarantees valid code.

```
website ──► server.js /generate-deepcad ──► this Space /generate ──► cad-sequence/v1
        ◄── FeatureScript + verification ◄── deepcadCompiler.js ◄──┘
```

## Get access to the model weights (one time)

The Text2CAD checkpoint is a **gated** Hugging Face dataset, so it only downloads with a
token from an account that accepted its terms:

1. Sign in at https://huggingface.co and open
   https://huggingface.co/datasets/SadilKhan/Text2CAD. Accept the access conditions.
2. Create a **Read** token at https://huggingface.co/settings/tokens.
3. Use that token as `HF_TOKEN` below (a Space secret when deployed, `.env` when local).

## Deploy (about 10 minutes, free CPU hardware is enough)

1. Create a Space at https://huggingface.co/new-space: pick **Docker** → **Blank**,
   hardware **CPU basic (free)**.
2. Upload this folder to it (from the repository root):
   ```bash
   pip install -U huggingface_hub
   huggingface-cli login
   huggingface-cli upload <your-username>/<space-name> hf_space . --repo-type=space
   ```
   The first build takes a while. It installs PyTorch (CPU) and bakes BERT-large into
   the image.
3. In the Space's **Settings → Variables and secrets**, add a secret `HF_TOKEN` with
   your read token (required: the Space downloads the gated checkpoint at startup).
   Optionally add a secret `API_TOKEN` with any long random string. Then only your app
   can call it.
4. Check it: open `https://<your-username>-<space-name>.hf.space/health`. Wait for
   `"status": "ready"`.
5. Point the CAD_AI app at it (`.env` locally, or Render → Environment):
   ```bash
   DEEPCAD_MODEL_URL=https://<your-username>-<space-name>.hf.space
   DEEPCAD_MODEL_TOKEN=<the API_TOKEN from step 3, if you set one>
   ```
6. On the website, choose **Generator → DeepCAD model**, describe a part and press
   **Generate**. The result shows whether it passed verification. Set the Onshape API
   keys (see the main README) and **Verify in Onshape** runs it in a real Part Studio.

Free Spaces sleep after a period without traffic. The first request after that takes
about a minute while the Space boots. The app waits and retries automatically.

## Run it locally (no Docker)

From the repository root, once:

```bash
git clone https://github.com/SadilKhan/Text2CAD .text2cad/Text2CAD
python -m venv .text2cad/venv
.text2cad/venv/Scripts/python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
.text2cad/venv/Scripts/python -m pip install -r hf_space/requirements.txt
```

Add `HF_TOKEN=<your read token>` and `DEEPCAD_MODEL_URL=http://127.0.0.1:7860` to `.env`,
then start the model service (first start downloads about 1.4 GB into `.text2cad/hf-cache`):

```bash
npm run deepcad:serve
```

`.text2cad/` is git-ignored. Start the website as usual (`npm start`) in another terminal.

## API

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | (none) | `{ ok, status: "loading"\|"ready"\|"error", error, device, model, weights }` |
| POST | `/generate` | `{ "prompt": "A ring." }` | `{ sequence, elapsedSec, model }`, 422 if the output isn't a usable CAD sequence |

`sequence` is `cad-sequence/v1`, documented at the top of `../deepcadCompiler.js`.

## How it works

- `app.py` loads Text2CAD and decodes the prompt into Text2CAD's token vector. It then
  decodes that with Text2CAD's own `CADSequence.from_vec`.
- `serialize.py` copies the sketch planes, line/arc/circle loops and extrude extents
  into `cad-sequence/v1`. It matches CadSeqProc's geometry conventions exactly.
- `occ_stub.py`: CadSeqProc imports pythonocc-core, which is conda-only. Only the
  pure-numpy decoding path is used here, so a stub satisfies those imports.
- Text2CAD's text encoder hard-codes `.to("cuda")`. `app.py` patches it so the Space
  runs on CPU.

## Tests (offline, no downloads)

```bash
git clone https://github.com/SadilKhan/Text2CAD /tmp/Text2CAD
pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r hf_space/requirements.txt
python hf_space/tests/test_space.py --text2cad /tmp/Text2CAD --out /tmp/decoded.json
node hf_space/tests/roundtrip_compare.mjs /tmp/decoded.json
```

The first script encodes a DeepCAD fixture with Text2CAD's own tokenizer, decodes it
and serializes it. The second checks that the decoded shape matches the original
within quantization. The script also runs the real Text2CAD network with random
weights through the HTTP API.

## License

Text2CAD's code and weights are **CC BY-NC-SA 4.0 (non-commercial)**. Use this
Space for personal, school or research projects, not commercial ones.
