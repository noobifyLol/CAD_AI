"""
Cloud deployment of CADFS-2B on Modal (https://modal.com) — serverless GPU that
SCALES TO ZERO, so you only pay per request and nothing while idle. This lets the
model be available 24/7 without keeping your PC on.

It serves the SAME HTTP API as the local model_service/cadfs_server.py
(GET /health, POST /generate {"description": ...}), so the Node app needs no code
change — just point CADFS_MODEL_URL at the deployed URL.

DEPLOY (one time):
    pip install modal
    modal setup                       # opens browser, links your Modal account
    modal deploy model_service/modal_app.py
Modal prints a URL like  https://<you>--cadfs-2b-web.modal.run
Put that in the app's environment:  CADFS_MODEL_URL=https://<you>--cadfs-2b-web.modal.run

COST: billed per-second of GPU only while a request runs; $0 while idle. A T4 is
plenty for a 2B model. Modal's monthly free credits typically cover light use.

NOTE: Modal's decorator names occasionally change between versions. If `modal
deploy` errors on a decorator, check https://modal.com/docs for the current name
(e.g. web_endpoint vs fastapi_endpoint vs asgi_app) — the model logic below is
unaffected.
"""
import modal

MODEL_ID = "VladPyatov/CADFS-2B"
SYSTEM_PROMPT = "You are CAD code generation model."
MAX_NEW_TOKENS = 2048

app = modal.App("cadfs-2b")


def _download_model():
    # Bake the ~5GB weights into the image at build time so cold starts only pay
    # for model LOAD (~15s), not a 5GB re-download every wake-up.
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_ID)


image = (
    modal.Image.debian_slim(python_version="3.11")
    # Modal GPUs use CUDA 12.x; the default torch wheel targets that. transformers
    # pinned to 4.51.3 (Qwen2-VL processor loading is broken in 5.x).
    .pip_install(
        "torch",
        "transformers==4.51.3",
        "accelerate",
        "pillow",
        "safetensors",
        "huggingface_hub",
        "fastapi[standard]",
    )
    .run_function(_download_model)
)


@app.cls(gpu="T4", image=image, scaledown_window=300, timeout=600)
class CADFS:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoProcessor, Qwen2VLForConditionalGeneration
        self.torch = torch
        self.model = Qwen2VLForConditionalGeneration.from_pretrained(
            MODEL_ID, torch_dtype=torch.bfloat16, device_map="cuda"
        )
        self.processor = AutoProcessor.from_pretrained(MODEL_ID)
        self.model.eval()

    def _generate(self, description: str) -> str:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": description},
        ]
        text = self.processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.processor(text=[text], return_tensors="pt").to(self.model.device)
        with self.torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
        trimmed = out[0][inputs.input_ids.shape[1]:]
        return self.processor.decode(trimmed, skip_special_tokens=True).strip()

    @modal.asgi_app()
    def web(self):
        import time
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse

        webapp = FastAPI()

        @webapp.get("/health")
        def health():
            return {"ok": True, "model": MODEL_ID}

        @webapp.post("/generate")
        async def generate(request: Request):
            data = await request.json()
            description = str(data.get("description", "")).strip()
            if not description:
                return JSONResponse({"error": "missing 'description'"}, status_code=400)
            started = time.time()
            fs = self._generate(description)
            return {"featurescript": fs, "elapsedSec": round(time.time() - started, 2)}

        return webapp
