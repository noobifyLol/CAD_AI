"""Flatten the Text2CAD data into JSONL files for build.mjs.

  .text2cad/data/minimal_json_0000_0099.zip -> .text2cad/data/parts.jsonl   {"uid", "json"}
  .text2cad/data/text2cad_v1.1.csv          -> .text2cad/data/texts.jsonl   {"uid", "abstract", "keywords", "beginner"}

Run: .text2cad/venv/Scripts/python scripts/deepcad_library/extract.py [parts|texts|all]
"""
import csv
import json
import pathlib
import sys
import zipfile

DATA = pathlib.Path(__file__).resolve().parents[2] / ".text2cad" / "data"


def parts():
    out = DATA / "parts.jsonl"
    count = 0
    with zipfile.ZipFile(DATA / "minimal_json_0000_0099.zip") as archive, out.open("w", encoding="utf-8") as sink:
        for name in archive.namelist():
            if not name.endswith(".json"):
                continue
            uid = "/".join(name.split("/")[:2])  # "0000/00001000"
            try:
                data = json.loads(archive.read(name))
            except ValueError:
                continue
            sink.write(json.dumps({"uid": uid, "json": data}, separators=(",", ":")) + "\n")
            count += 1
    print(f"parts.jsonl: {count} parts")


def texts():
    csv.field_size_limit(1 << 30)
    out = DATA / "texts.jsonl"
    count = 0
    with (DATA / "text2cad_v1.1.csv").open(encoding="utf-8", newline="") as source, out.open("w", encoding="utf-8") as sink:
        for row in csv.DictReader(source):
            uid = (row.get("uid") or "").strip()
            abstract = (row.get("abstract") or "").strip()
            if not uid or not abstract:
                continue
            sink.write(json.dumps({
                "uid": uid,
                "abstract": abstract,
                "keywords": (row.get("keywords") or "").strip(),
                "beginner": (row.get("beginner") or "").strip()[:600],
            }, ensure_ascii=False) + "\n")
            count += 1
    print(f"texts.jsonl: {count} descriptions")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("parts", "all"):
        parts()
    if which in ("texts", "all"):
        texts()
