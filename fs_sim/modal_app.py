"""FeatureScript simulator (fs_sim) as a small web service on Modal (https://modal.com).

The website on Render's free plan has 512 MB of memory and the simulator's Python worker
needs about 350 MB, so it runs here instead: a CPU container that starts on the first
request and shuts down after a few idle minutes, so it only uses credits while parts are
being checked (Modal's Starter plan: $1/month free without a payment method).

    POST /simulate  {"code": "...", "render": false}  ->  same JSON as fs_sim/worker.py
    GET  /health                                       ->  {"ok": true}

Deploy (from the repository root):
    npm run sim:modal-secret   # stores a generated FS_SIM_TOKEN on Modal and in .env
    npm run sim:deploy         # prints the URL
Then set on Render (Environment) and in .env:
    FS_SIM_URL=https://<workspace>--cad-ai-fs-sim-web.modal.run
    FS_SIM_TOKEN=<the FS_SIM_TOKEN in .env>
"""
import pathlib

import modal

HERE = pathlib.Path(__file__).resolve().parent
STD_COMMIT = "a2a7b13ea823f144b20d27198043aea35a64d928"  # same pin as fs_sim/fetch_std.sh
FSGEN_COMMIT = "eabcc02ba104005da3de869e613cefe53042fd98"  # onshape-fsgen release 0.2.0

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libx11-6", "libxrender1", "libxext6", "libglib2.0-0")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .pip_install("fastapi[standard]")
    .run_commands(
        "mkdir -p /opt/fs_sim_std && cd /opt/fs_sim_std && git init -q"
        " && git remote add origin https://github.com/javawizard/onshape-std-library-mirror"
        f" && git fetch -q --depth 1 origin {STD_COMMIT} && git checkout -q FETCH_HEAD && rm -rf .git"
    )
    # FS-Lite test build (onshape-fsgen, MIT): the second checker, same as scripts/local_build.py.
    .pip_install("build123d")
    .run_commands(
        "git clone -q https://github.com/Lucasfrit/onshape-fsgen /opt/onshape-fsgen"
        f" && cd /opt/onshape-fsgen && git checkout -q {FSGEN_COMMIT} && rm -rf .git"
    )
    .env({"FS_STD_DIR": "/opt/fs_sim_std", "PYTHONPATH": "/root", "FSGEN_DIR": "/opt/onshape-fsgen"})
    .add_local_dir(str(HERE), remote_path="/root/fs_sim", ignore=["std", "__pycache__", "tests", "modal_app.py"])
    .add_local_file(str(HERE.parent / "scripts" / "local_build.py"), remote_path="/root/local_build.py")
)

app = modal.App("cad-ai-fs-sim")


@app.function(image=image, cpu=1.0, memory=1024, timeout=120, scaledown_window=300,
              secrets=[modal.Secret.from_name("cad-ai-fs-sim")])
@modal.concurrent(max_inputs=1)
@modal.asgi_app()
def web():
    import os

    from fastapi import FastAPI, Header, HTTPException

    from fs_sim.runtime import library
    from fs_sim.worker import handle

    library()  # parse Onshape's std library once per container
    api = FastAPI()
    token = os.environ.get("FS_SIM_TOKEN", "")

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/build")
    def build(body: dict, authorization: str = Header(default="")):
        """FS-Lite test build: {"ok", "error", "line", "metrics"} like scripts/local_build.py."""
        if token and authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="bad token")
        import local_build
        return local_build.build(str(body.get("code", ""))[:200_000], "remote")

    @api.post("/simulate")
    def simulate(body: dict, authorization: str = Header(default="")):
        if token and authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="bad token")
        code = str(body.get("code", ""))[:200_000]
        try:
            return handle({"code": code, "render": bool(body.get("render"))})
        except Exception as err:  # report, never crash the container
            return {"ok": False, "errors": [], "warnings": [], "parts": [], "gaps": [f"simulator crash: {type(err).__name__}: {err}"]}

    return api
