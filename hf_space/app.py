"""Text2CAD (text → DeepCAD sketch/extrude sequence) as an HTTP API for CAD_AI.

Runs as a Hugging Face Docker Space (see README.md). The CAD_AI web app calls
POST /generate, gets back a "cad-sequence/v1" JSON, and compiles it into
FeatureScript with deepcadCompiler.js — so the model decides the geometry and a
deterministic compiler guarantees valid FeatureScript.

Endpoints
  GET  /health    → {"ok", "status": "loading"|"ready"|"error", "device", "error"}
  POST /generate  {"prompt": "...", "nucleus_prob": 0, "topk_index": 1}
                  → {"sequence": {...cad-sequence/v1...}, "elapsedSec", "model"}

Environment
  API_TOKEN            optional; when set, requests need "Authorization: Bearer <token>"
  TEXT2CAD_DIR         Text2CAD source checkout (default /opt/Text2CAD)
  TEXT2CAD_CHECKPOINT  local .pth path; default downloads it from the Hub
  TEXT2CAD_RANDOM_WEIGHTS=1  testing only: skip all downloads, random weights
"""
import os
import sys
import threading
import time

import occ_stub

OCC_STUBBED = occ_stub.install_if_missing()

TEXT2CAD_DIR = os.environ.get("TEXT2CAD_DIR", "/opt/Text2CAD")
for path in (TEXT2CAD_DIR, os.path.join(TEXT2CAD_DIR, "Cad_VLM")):
    if path not in sys.path:
        sys.path.insert(0, path)

import torch  # noqa: E402
import yaml  # noqa: E402
from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from serialize import cad_sequence_to_v1  # noqa: E402

CHECKPOINT_REPO = "SadilKhan/Text2CAD"
CHECKPOINT_FILE = "text2cad_v1.0/Text2CAD_1.0.pth"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
API_TOKEN = os.environ.get("API_TOKEN", "").strip()
RANDOM_WEIGHTS = os.environ.get("TEXT2CAD_RANDOM_WEIGHTS") == "1"

state = {"status": "loading", "error": None, "model": None, "loadedSec": None, "weights": None}
generate_lock = threading.Lock()  # one decode at a time; CPU Spaces have 2 vCPUs


def _patch_text_embedder():
    """Text2CAD's TextEmbedder.get_embedding hard-codes .to("cuda"); use the model's device."""
    from Cad_VLM.models.layers import text_embed

    def get_embedding(self, texts):
        if isinstance(texts, str):
            texts = [texts]
        device = next(self.model.parameters()).device
        with torch.no_grad():
            inputs = self.tokenizer(
                texts, return_tensors="pt", max_length=self.max_seq_len, truncation=True, padding=True
            ).to(device)
            embedding = self.model(**inputs)[0]
            key_padding_mask = inputs["attention_mask"] == 0
        return embedding, key_padding_mask

    text_embed.TextEmbedder.get_embedding = get_embedding

    if RANDOM_WEIGHTS:
        # Offline test mode: a small randomly initialised BERT with BERT-large's width
        # (1024), so the real decoder runs end to end without any downloads.
        from transformers import BertConfig, BertModel

        class _OfflineTokenizer:
            def __call__(self, texts, return_tensors, max_length, truncation, padding):
                from transformers import BatchEncoding

                ids = [[101] + [1000 + (ord(ch) % 20000) for ch in text[: max_length - 2]] + [102] for text in texts]
                width = max(len(row) for row in ids)
                input_ids = torch.tensor([row + [0] * (width - len(row)) for row in ids])
                return BatchEncoding({"input_ids": input_ids, "attention_mask": (input_ids != 0).long()})

        def offline_init(self, model_name, cache_dir, max_seq_len):
            torch.nn.Module.__init__(self)
            self.max_seq_len = max_seq_len
            self.model_name = model_name
            self.tokenizer = _OfflineTokenizer()
            self.model = BertModel(BertConfig(hidden_size=1024, num_hidden_layers=2, num_attention_heads=8,
                                              intermediate_size=1024, max_position_embeddings=max_seq_len))

        text_embed.TextEmbedder.__init__ = offline_init


def _load():
    started = time.time()
    try:
        _patch_text_embedder()
        from Cad_VLM.models.text2cad import Text2CAD
        from CadSeqProc.utility.macro import MAX_CAD_SEQUENCE_LENGTH

        with open(os.path.join(TEXT2CAD_DIR, "Cad_VLM", "config", "inference_user_input.yaml")) as handle:
            config = yaml.safe_load(handle)
        # None = the standard Hub cache under $HF_HOME, where the Dockerfile pre-downloads BERT.
        config["text_encoder"]["text_embedder"]["cache_dir"] = None
        cad_config = config["cad_decoder"]
        cad_config["cad_seq_len"] = MAX_CAD_SEQUENCE_LENGTH
        model = Text2CAD(text_config=config["text_encoder"], cad_config=cad_config).to(DEVICE)

        if not RANDOM_WEIGHTS:
            checkpoint_path = os.environ.get("TEXT2CAD_CHECKPOINT")
            if not checkpoint_path:
                from huggingface_hub import hf_hub_download
                from huggingface_hub.errors import GatedRepoError

                try:
                    # The dataset is gated: HF_TOKEN must belong to an account that accepted its terms.
                    checkpoint_path = hf_hub_download(CHECKPOINT_REPO, CHECKPOINT_FILE, repo_type="dataset")
                except GatedRepoError as err:
                    raise RuntimeError(
                        f"The Text2CAD checkpoint is gated. Accept the terms at "
                        f"https://huggingface.co/datasets/{CHECKPOINT_REPO} and set HF_TOKEN to a read token "
                        f"from that account ({'HF_TOKEN is set but was refused' if os.environ.get('HF_TOKEN') else 'HF_TOKEN is not set'})."
                    ) from err
            checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
            weights = {
                (key.split(".", 1)[1] if key.startswith("module.") else key): value
                for key, value in checkpoint["model_state_dict"].items()
            }
            # strict=False tolerates naming drift, so report how much actually loaded:
            # a mismatch would otherwise silently leave random weights in place.
            result = model.load_state_dict(weights, strict=False)
            state["weights"] = {
                "loaded": len(weights) - len(result.unexpected_keys),
                "missing": len(result.missing_keys),
                "unexpected": len(result.unexpected_keys),
            }
            if len(result.missing_keys) > len(weights) // 2:
                raise RuntimeError(f"Checkpoint does not match the model: {len(result.missing_keys)} weights missing.")

        model.eval()
        state.update(model=model, status="ready", loadedSec=round(time.time() - started, 1))
    except Exception as err:  # surfaced through /health so a broken Space is diagnosable
        state.update(status="error", error=f"{type(err).__name__}: {err}")


def decode(prompt, nucleus_prob=0.0, topk_index=1):
    from CadSeqProc.cad_sequence import CADSequence
    from CadSeqProc.utility.macro import MAX_CAD_SEQUENCE_LENGTH, N_BIT

    with generate_lock, torch.no_grad():
        output = state["model"].test_decode(
            texts=[prompt],
            maxlen=MAX_CAD_SEQUENCE_LENGTH,
            nucleus_prob=nucleus_prob,
            topk_index=topk_index,
            device=DEVICE,
        )
    vector = output["cad_vec"][0].cpu().numpy()
    cad_seq = CADSequence.from_vec(vector, bit=N_BIT, post_processing=True)
    return cad_sequence_to_v1(cad_seq)


app = FastAPI(title="CAD_AI Text2CAD service")
threading.Thread(target=_load, daemon=True).start()


class GenerateRequest(BaseModel):
    prompt: str = ""
    description: str = ""  # alias used by the CADFS model service
    nucleus_prob: float = 0.0
    topk_index: int = 1


def _check_auth(authorization):
    if API_TOKEN and authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Missing or wrong API token.")


@app.get("/")
def root():
    return {"service": "CAD_AI Text2CAD", "endpoints": ["GET /health", "POST /generate"]}


@app.get("/health")
def health():
    return {
        "ok": state["status"] == "ready",
        "status": state["status"],
        "error": state["error"],
        "device": str(DEVICE),
        "model": "Text2CAD v1.0 (random weights — test mode)" if RANDOM_WEIGHTS else "Text2CAD v1.0",
        "loadedSec": state["loadedSec"],
        "weights": state["weights"],
        "occStubbed": OCC_STUBBED,
    }


@app.post("/generate")
def generate(request: GenerateRequest, authorization: str = Header(default="")):
    _check_auth(authorization)
    prompt = (request.prompt or request.description).strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="No prompt provided.")
    if state["status"] == "loading":
        raise HTTPException(status_code=503, detail="Model is still loading; retry in ~30 s.")
    if state["status"] == "error":
        raise HTTPException(status_code=500, detail=f"Model failed to load: {state['error']}")

    started = time.time()
    try:
        sequence = decode(prompt[:2000], request.nucleus_prob, max(1, request.topk_index))
    except Exception as err:
        raise HTTPException(status_code=422, detail=f"Model output could not be decoded into a CAD sequence: {err}")
    if not sequence["steps"]:
        raise HTTPException(status_code=422, detail="Model produced no usable sketch/extrude steps.")
    return {"sequence": sequence, "elapsedSec": round(time.time() - started, 2), "model": health()["model"]}
