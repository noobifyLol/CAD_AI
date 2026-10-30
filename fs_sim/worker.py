"""Long-lived simulation worker for the Node app (simulatorClient.js).

Reads one JSON request per line on stdin and writes one JSON response per line:
    {"id": 1, "code": "...", "render": true}
 -> {"id": 1, "ok": true, "parts": [...], "errors": [...], "warnings": [...],
     "gaps": [...], "png": "<base64>", "elapsedMs": 812}
Keeping the process alive avoids paying Python + OpenCascade + std start-up per check.
"""
import base64
import json
import os
import sys
import tempfile
import time
import traceback


def handle(request):
    from .run import run_feature
    started = time.time()
    result = run_feature(request.get("code", ""))
    shapes = result.pop("_shapes", [])
    result.pop("trace", None)
    if request.get("render") and shapes:
        from .render import render_png
        fd, path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            render_png(shapes, path, title=result.get("feature") or "")
            with open(path, "rb") as handle_:
                result["png"] = base64.b64encode(handle_.read()).decode("ascii")
        finally:
            os.unlink(path)
    result["elapsedMs"] = int((time.time() - started) * 1000)
    return result


def main():
    from .runtime import library
    library()  # parse/load the std library once, up front
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            response = handle(request)
        except Exception as err:
            response = {"ok": False, "errors": [], "warnings": [], "parts": [],
                        "gaps": [f"simulator crash: {type(err).__name__}: {err}"],
                        "trace": traceback.format_exc()[-1500:]}
        response["id"] = request_id
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
