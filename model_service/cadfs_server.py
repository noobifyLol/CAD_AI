"""
Local inference server for VladPyatov/CADFS-2B (fine-tuned Qwen2-VL-2B, MIT).

Loads the model once onto the GPU and exposes a tiny HTTP endpoint the Node app
can call: POST /generate {"description": "..."} -> {"featurescript": "..."}.

Text-to-FeatureScript only (the model also supports multi-view images; not wired
here). Output is FeatureScript 1913 reconstruction style — impressive shape
fidelity, but non-parametric (no editable dialog sliders).

Run:  .venv/Scripts/python.exe model_service/cadfs_server.py
Env:  CADFS_MODEL_ID (default VladPyatov/CADFS-2B), CADFS_PORT (default 8765),
      CADFS_MAX_NEW_TOKENS (default 2048)
"""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

MODEL_ID = os.environ.get("CADFS_MODEL_ID", "VladPyatov/CADFS-2B")
PORT = int(os.environ.get("CADFS_PORT", "8765"))
MAX_NEW_TOKENS = int(os.environ.get("CADFS_MAX_NEW_TOKENS", "2048"))
SYSTEM_PROMPT = os.environ.get("CADFS_SYSTEM_PROMPT", "You are CAD code generation model.")

print(f"[cadfs] loading {MODEL_ID} ...", flush=True)
_load_start = time.time()

from transformers import AutoProcessor  # noqa: E402

# Qwen2-VL class name has moved across transformers versions; try the specific
# class, then fall back to the generic image-text-to-text auto class.
model = None
try:
    from transformers import Qwen2VLForConditionalGeneration
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        MODEL_ID, torch_dtype=torch.bfloat16, device_map="cuda"
    )
except Exception as exc:  # noqa: BLE001
    print(f"[cadfs] Qwen2VLForConditionalGeneration path failed ({exc}); trying AutoModelForImageTextToText", flush=True)
    from transformers import AutoModelForImageTextToText
    model = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID, torch_dtype=torch.bfloat16, device_map="cuda"
    )

processor = AutoProcessor.from_pretrained(MODEL_ID)
model.eval()
print(f"[cadfs] model ready in {time.time() - _load_start:.1f}s on {torch.cuda.get_device_name(0)}", flush=True)


def generate_featurescript(description: str) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": description},
    ]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], return_tensors="pt").to(model.device)
    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
    trimmed = generated[0][inputs.input_ids.shape[1]:]
    return processor.decode(trimmed, skip_special_tokens=True).strip()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "model": MODEL_ID, "device": torch.cuda.get_device_name(0)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/generate":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length) or b"{}")
            description = str(data.get("description", "")).strip()
            if not description:
                self._send(400, {"error": "missing 'description'"})
                return
            started = time.time()
            fs = generate_featurescript(description)
            self._send(200, {"featurescript": fs, "elapsedSec": round(time.time() - started, 2)})
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": str(exc)})

    def log_message(self, *args):  # quiet default logging
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[cadfs] serving on http://127.0.0.1:{PORT}  (POST /generate, GET /health)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[cadfs] shutting down", flush=True)
        server.shutdown()
