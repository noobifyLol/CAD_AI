"""Text2CAD service on Modal (https://modal.com): free monthly credits, scales to zero.

Runs the same FastAPI app as the Hugging Face Space (app.py: GET /health, POST /generate)
on a CPU container that starts on the first request and shuts down after a few idle
minutes, so it only uses credits while parts are being generated. Hugging Face now
charges for CPU Spaces; Modal's free Starter credits cover this comfortably.

One time (from the repository root, see README.md "Deploy on Modal"):
    npm run deepcad:modal-secret   # stores HF_TOKEN and a generated API_TOKEN on Modal
    npm run deepcad:deploy         # builds the image and prints the URL
Then set on the website host (Render → Environment) and in .env:
    DEEPCAD_MODEL_URL=https://<workspace>--cad-ai-text2cad-web.modal.run
    DEEPCAD_MODEL_TOKEN=<the DEEPCAD_MODEL_TOKEN that deepcad:modal-secret wrote to .env>

When the credits run out or the service is down, the website's Auto generator falls
back to Parametric AI and tells the user.
"""
import pathlib

import modal

HERE = pathlib.Path(__file__).resolve().parent
TEXT2CAD_COMMIT = "669a81472ede2269837c22a4d00070eaac360c82"  # same pin as the Dockerfile
CHECKPOINT_DIR = "/opt/text2cad-checkpoint"
SECRET = modal.Secret.from_name("cad-ai-text2cad")  # HF_TOKEN (gated checkpoint) + API_TOKEN

app = modal.App("cad-ai-text2cad")


def _download_checkpoint():
    # The checkpoint is gated, so it is fetched once at build time with HF_TOKEN and
    # baked into the image: cold starts then only load weights instead of downloading.
    from huggingface_hub import hf_hub_download

    hf_hub_download("SadilKhan/Text2CAD", "text2cad_v1.0/Text2CAD_1.0.pth", repo_type="dataset", local_dir=CHECKPOINT_DIR)


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install("torch==2.6.0", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .run_commands(
        "git init /opt/Text2CAD",
        "cd /opt/Text2CAD && git remote add origin https://github.com/SadilKhan/Text2CAD"
        f" && git fetch --depth 1 origin {TEXT2CAD_COMMIT} && git checkout FETCH_HEAD",
    )
    .env({
        "HF_HOME": "/opt/hf-cache",
        "TEXT2CAD_DIR": "/opt/Text2CAD",
        "TEXT2CAD_CHECKPOINT": f"{CHECKPOINT_DIR}/text2cad_v1.0/Text2CAD_1.0.pth",
    })
    .run_commands(
        "python -c \"from huggingface_hub import snapshot_download; "
        "snapshot_download('google-bert/bert-large-uncased', allow_patterns=['*.json', '*.txt', '*.safetensors'])\""
    )
    .run_function(_download_checkpoint, secrets=[SECRET])
    .add_local_dir(str(HERE), "/root/hf_space", ignore=["tests", "__pycache__", "*.md", "Dockerfile", ".dockerignore"])
)


@app.function(
    image=image,
    secrets=[SECRET],
    cpu=2.0,
    memory=4096,
    scaledown_window=180,  # idle minutes are billed, so shut down fairly soon
    timeout=600,
    max_containers=1,  # one small CPU container is plenty and caps credit use
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def web():
    import os
    import sys

    sys.path.insert(0, "/root/hf_space")
    os.chdir("/root/hf_space")
    from app import app as fastapi_app  # starts loading the model in a background thread

    return fastapi_app
