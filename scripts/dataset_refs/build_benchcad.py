"""Builds data/benchcad_refs.json.gz: real named mechanical parts as CadQuery programs.

Source: BenchCAD (https://huggingface.co/datasets/BenchCAD/BenchCAD, CC-BY 4.0), the
"code_gen" config: 106 part families (washer, motor end cap, flange, ...) with clean
CadQuery code using holes, chamfers, fillets, revolves and shells.

Keeps up to 4 short, varied programs per family so the website can show the AI a real
design for the part it is asked to make (datasetReferences.js).

    .fsgen/venv/Scripts/python scripts/dataset_refs/build_benchcad.py
(download first: the code_gen parquet files into .datasets/BenchCAD, see README)
"""
import glob
import gzip
import json
import pathlib
import re

import pyarrow.parquet as pq

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = sorted(glob.glob(str(ROOT / ".datasets" / "BenchCAD" / "code_gen" / "data" / "*.parquet")))
OUT = ROOT / "data" / "benchcad_refs.json.gz"
PER_FAMILY = 4
MAX_CODE = 1600

families = {}
for path in FILES:
    table = pq.read_table(path, columns=["family", "variant", "difficulty", "standard", "base_plane", "code"])
    for row in table.to_pylist():
        code = (row["code"] or "").replace("\r\n", "\n")
        code = re.sub(r"\n*# Export\s*\n?show_object\(result\)\s*$", "", code).strip()
        if not code or len(code) > MAX_CODE:
            continue
        families.setdefault(row["family"], []).append({**row, "code": code})

refs = []
for family, rows in sorted(families.items()):
    rows.sort(key=lambda r: len(r["code"]))
    picked, seen = [], set()
    # one per variant first (most variety), then shortest remaining
    for row in rows:
        key = (row["variant"], row["difficulty"])
        if key in seen:
            continue
        seen.add(key)
        picked.append(row)
        if len(picked) >= PER_FAMILY:
            break
    for row in picked:
        refs.append({
            "family": family,
            "variant": row["variant"] or "",
            "standard": row["standard"] or "",
            "difficulty": row["difficulty"] or "",
            "code": row["code"],
        })

OUT.write_bytes(gzip.compress(json.dumps({
    "source": "BenchCAD code_gen (CC-BY 4.0, https://huggingface.co/datasets/BenchCAD/BenchCAD)",
    "refs": refs,
}).encode("utf-8"), 9))
ops = {op: sum(1 for r in refs if f".{op}(" in r["code"]) for op in ["revolve", "fillet", "chamfer", "shell", "hole", "sweep", "loft", "polarArray"]}
print(f"{len(families)} families, {len(refs)} programs, {OUT.stat().st_size / 1e3:.0f} KB; programs using: {ops}")
