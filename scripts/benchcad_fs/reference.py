"""Reference geometry for every BenchCAD program in data/benchcad_refs.json.gz, measured with
CadQuery itself, so the FeatureScript conversions (benchcadCompiler.js) can be checked exactly.

    .cq-venv/Scripts/python scripts/benchcad_fs/reference.py  ->  data/benchcad_reference.json

(.cq-venv: `uv venv .cq-venv --python 3.12 && uv pip install --python .cq-venv/Scripts/python.exe cadquery`)
"""
import gzip
import json
import pathlib
import time

import cadquery as cq  # noqa: F401  (the programs import it themselves)

ROOT = pathlib.Path(__file__).resolve().parents[2]
refs = json.loads(gzip.decompress((ROOT / "data" / "benchcad_refs.json.gz").read_bytes()))["refs"]
out = {}
for index, ref in enumerate(refs):
    key = f"{ref['family']}#{index}"
    started = time.time()
    try:
        scope = {}
        exec(ref["code"], scope)  # trusted: BenchCAD programs bundled in this repo
        result = scope["result"]
        shape = result.val() if hasattr(result, "val") else result
        solids = shape.Solids() if hasattr(shape, "Solids") else [shape]
        box = shape.BoundingBox()
        out[key] = {
            "family": ref["family"],
            "volume_mm3": round(sum(s.Volume() for s in solids), 3),
            "bodies": len(solids),
            "faces": len(shape.Faces()),
            "bbox_mm": [round(v, 3) for v in (box.xmin, box.ymin, box.zmin, box.xmax, box.ymax, box.zmax)],
            "seconds": round(time.time() - started, 2),
        }
    except Exception as err:  # noqa: BLE001
        out[key] = {"family": ref["family"], "error": f"{type(err).__name__}: {err}"[:200]}
(ROOT / "data" / "benchcad_reference.json").write_text(json.dumps(out, indent=0))
ok = sum(1 for v in out.values() if "volume_mm3" in v)
print(f"{ok}/{len(out)} programs measured")
