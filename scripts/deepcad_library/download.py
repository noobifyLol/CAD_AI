"""Download the Text2CAD/DeepCAD part data used to build the DeepCAD part library.

Needs HF_TOKEN (in .env) from an account that accepted the dataset terms.
Run: .text2cad/venv/Scripts/python scripts/deepcad_library/download.py
Files land in .text2cad/data/ (git-ignored):
  minimal_json_0000_0099.zip  every part's sketch/extrude sequence (Text2CAD minimal JSON)
  text2cad_v1.1.csv           text descriptions per part (abstract, keywords, levels)
"""
import os
import pathlib
import shutil

from huggingface_hub import hf_hub_download

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / ".text2cad" / "data"
FILES = [
    "text2cad_v1.0/misc/minimal_json/minimal_json_0000_0099.zip",
    "text2cad_v1.1/text2cad_v1.1.csv",
]


def main():
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    token = os.environ.get("HF_TOKEN") or env.get("HF_TOKEN")
    OUT.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = OUT / pathlib.Path(name).name
        if target.exists():
            print(f"have {target.name} ({target.stat().st_size / 1e6:.0f} MB)")
            continue
        path = hf_hub_download("SadilKhan/Text2CAD", name, repo_type="dataset", token=token, cache_dir=str(OUT / ".cache"))
        shutil.copyfile(path, target)
        print(f"downloaded {target.name} ({target.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
