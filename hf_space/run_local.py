"""Run the Text2CAD service on this computer (no Docker), for local testing.

One-time setup, from the repository root (see README.md, "Run it locally"):
    git clone https://github.com/SadilKhan/Text2CAD .text2cad/Text2CAD
    python -m venv .text2cad/venv
    .text2cad/venv/Scripts/python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
    .text2cad/venv/Scripts/python -m pip install -r hf_space/requirements.txt

Then:
    .text2cad/venv/Scripts/python hf_space/run_local.py      (or: npm run deepcad:serve)

Reads HF_TOKEN from the repository's .env, keeps downloads in .text2cad/hf-cache,
and serves on http://127.0.0.1:7860 (set DEEPCAD_MODEL_URL to that in .env).
"""
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
RUNTIME = ROOT / ".text2cad"


def read_env_file(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def main():
    env = read_env_file(ROOT / ".env")
    for key in ("HF_TOKEN", "API_TOKEN", "TEXT2CAD_CHECKPOINT"):
        if env.get(key) and not os.environ.get(key):
            os.environ[key] = env[key]
    os.environ.setdefault("HF_HOME", str(RUNTIME / "hf-cache"))
    os.environ.setdefault("TEXT2CAD_DIR", str(RUNTIME / "Text2CAD"))
    if not pathlib.Path(os.environ["TEXT2CAD_DIR"], "Cad_VLM").is_dir():
        sys.exit(f"Text2CAD source not found at {os.environ['TEXT2CAD_DIR']}. See the setup steps at the top of this file.")
    if not os.environ.get("HF_TOKEN") and not os.environ.get("TEXT2CAD_CHECKPOINT"):
        print("Warning: HF_TOKEN is not set, so the gated Text2CAD checkpoint cannot be downloaded.", file=sys.stderr)

    os.chdir(HERE)
    sys.path.insert(0, str(HERE))
    import uvicorn

    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run("app:app", host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
