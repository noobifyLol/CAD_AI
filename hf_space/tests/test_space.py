"""Offline tests for the Text2CAD Space (no Hub downloads, no GPU).

  python hf_space/tests/test_space.py --text2cad /path/to/Text2CAD --out /tmp/decoded.json

1. Round trip: a DeepCAD JSON fixture is encoded with Text2CAD's own json_to_vec
   (normalize + 8-bit quantize — exactly the token format the model emits), decoded
   with CADSequence.from_vec, and serialized to cad-sequence/v1 (written to --out so
   hf_space/tests/roundtrip_compare.mjs can check it against the original geometry).
2. API: the FastAPI app runs the real Text2CAD architecture with random weights
   (TEXT2CAD_RANDOM_WEIGHTS=1); /health must reach "ready" and /generate must answer
   200 with a sequence or a clean 422 — never a crash.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SPACE = os.path.dirname(HERE)
REPO = os.path.dirname(SPACE)

parser = argparse.ArgumentParser()
parser.add_argument("--text2cad", required=True)
parser.add_argument("--out", required=True)
args = parser.parse_args()

os.environ["TEXT2CAD_DIR"] = args.text2cad
os.environ["TEXT2CAD_RANDOM_WEIGHTS"] = "1"
sys.path.insert(0, SPACE)
sys.path.insert(0, args.text2cad)

import occ_stub  # noqa: E402

occ_stub.install_if_missing()
from CadSeqProc.cad_sequence import CADSequence  # noqa: E402
from CadSeqProc.utility.macro import N_BIT  # noqa: E402
from serialize import cad_sequence_to_v1, extrude_interval  # noqa: E402

failures = 0


def check(label, ok, detail=""):
    global failures
    print(("PASS " if ok else "FAIL ") + label + ("" if ok or not detail else f" — {detail}"))
    failures += 0 if ok else 1


# extrude_interval mirrors SketchSequence.extrudeBasedOnType
check("interval one-sided", extrude_interval(0.3, 0.0) == (0.3, 0.0))
check("interval reversed-only", extrude_interval(0.0, 0.2) == (0.0, 0.2))
check("interval two-sided", extrude_interval(0.3, 0.2) == (0.3, 0.2))
check("interval negative extent_one", extrude_interval(-0.3, 0.0) == (0.0, 0.3))

with open(os.path.join(REPO, "data", "deepcad_fixtures", "deepcad_plate_boss_pin.json")) as handle:
    fixture = json.load(handle)
_, cad_vec, _, _ = CADSequence.json_to_vec(fixture, bit=N_BIT, padding=True)
decoded = CADSequence.from_vec(cad_vec.numpy(), bit=N_BIT, post_processing=True)
sequence = cad_sequence_to_v1(decoded)
with open(args.out, "w") as handle:
    json.dump(sequence, handle)
ops = [step["extrude"]["operation"] for step in sequence["steps"]]
check("round trip keeps 3 steps", len(sequence["steps"]) == 3, str(ops))
check("round trip operations", ops == ["new", "join", "cut"], str(ops))
curve_types = sorted(c["type"] for step in sequence["steps"] for f in step["faces"] for loop in f["loops"] for c in loop)
check("round trip curve types", curve_types == sorted(["line"] * 6 + ["arc"] * 2 + ["circle"] * 2), str(curve_types))

# API with the real Text2CAD decoder (random weights)
from fastapi.testclient import TestClient  # noqa: E402

import app as space  # noqa: E402

client = TestClient(space.app)
deadline = time.time() + 300
while space.state["status"] == "loading" and time.time() < deadline:
    time.sleep(1)
health = client.get("/health").json()
check("health ready", health["status"] == "ready", json.dumps(health))
check("rejects empty prompt", client.post("/generate", json={"prompt": ""}).status_code == 400)
started = time.time()
response = client.post("/generate", json={"prompt": "A rectangular plate with four holes."})
body = response.json()
check(
    f"generate answers cleanly with random weights ({time.time() - started:.1f}s, HTTP {response.status_code})",
    response.status_code in (200, 422),
    json.dumps(body)[:300],
)
if response.status_code == 200:
    check("generate returns cad-sequence/v1", body["sequence"]["format"] == "cad-sequence/v1")

space.API_TOKEN = "secret"
check("API token enforced", client.post("/generate", json={"prompt": "x"}).status_code == 401)
check(
    "API token accepted",
    client.post("/generate", json={"prompt": ""}, headers={"Authorization": "Bearer secret"}).status_code == 400,
)

print("\nALL SPACE CHECKS PASSED" if not failures else f"\n{failures} SPACE CHECK(S) FAILED")
sys.exit(1 if failures else 0)
