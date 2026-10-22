"""Test-build FeatureScript custom features locally, with no Onshape API calls.

Uses the FS-Lite interpreter and OpenCascade builder from onshape-fsgen
(https://github.com/Lucasfrit/onshape-fsgen, MIT), checked out in .fsgen/onshape-fsgen with
its own virtualenv in .fsgen/venv (see README "Local test build").

  .fsgen/venv/Scripts/python scripts/local_build.py part.fs [more.fs ...]
  .fsgen/venv/Scripts/python scripts/local_build.py --stdin        (one file's source on stdin)
  .fsgen/venv/Scripts/python scripts/local_build.py --png out/ part.fs   (also save a 4-view picture)

Prints one JSON object per file: {"file", "ok", "error", "line", "metrics", "seconds"}.
The feature is built with its dialog defaults, like inserting it in a Part Studio.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".fsgen" / "onshape-fsgen"))

from fsgen.fslite import interp as _interp  # noqa: E402
from fsgen.fslite.runner import render_png, run_source  # noqa: E402
from fsgen.fslite.stdlib import QList  # noqa: E402

# FS-Lite fills numeric/boolean/string dialog parameters with their defaults but leaves
# selection parameters (`definition.location is Query;`) undefined. In Onshape an
# unpicked selection is an empty query, so `isQueryEmpty(context, definition.location)`
# is true and the feature uses its default plane. Give query parameters that default.
_original_collect = _interp.Interpreter.collect_parameters


def _collect_with_query_defaults(self, ff, overrides=None):
    definition, params = _original_collect(self, ff, overrides)
    stack = [ff.fn.node.precondition] if ff.fn.node.precondition is not None else []
    while stack:
        node = stack.pop()
        kind = getattr(node, "kind", None)
        if kind == "block":
            stack.extend(node.stmts)
        elif kind == "if":
            stack.extend(x for x in (node.then, node.other) if x is not None)
        elif kind == "exprstmt" and node.expr.kind == "istype" and node.expr.type == "Query":
            target = node.expr.expr
            if target.kind == "member" and target.obj.kind == "name" and target.obj.name == "definition":
                definition.setdefault(target.name, QList([]))
    return definition, params


_interp.Interpreter.collect_parameters = _collect_with_query_defaults


# Two Onshape behaviours FS-Lite does not cover yet, added here without editing its code:
#   skFitSpline  - smooth curve through points (revolved bottles, vases, organic profiles)
#   opShell      - given a whole BODY (no faces to remove) Onshape hollows it into a closed shell
from fsgen.fslite import stdlib as _std  # noqa: E402
from fsgen.fslite import geom as _G  # noqa: E402
from build123d import Edge as _B3dEdge  # noqa: E402
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut  # noqa: E402
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape  # noqa: E402
from OCP.BRepOffset import BRepOffset_Skin  # noqa: E402
from OCP.GeomAbs import GeomAbs_Intersection  # noqa: E402

_original_register = _std.StdLib._register


def _register_with_extras(self):
    _original_register(self)
    FSError = _std.FSError

    def sk_fit_spline(sk, name, m):
        if not isinstance(sk, _G.Sketch) or sk.solved:
            raise FSError("skFitSpline: first argument must be an unsolved sketch from newSketchOnPlane")
        m = _std.need_map(m, "skFitSpline")
        points = _std.req(m, "points", "skFitSpline")
        if not isinstance(points, list) or len(points) < 2:
            raise FSError('skFitSpline: "points" must be an array of at least 2 points')
        world = [sk.plane.to_world(_std.as_point2(p, "skFitSpline point")) for p in points]
        closed = len(world) > 2 and sum((a - b) ** 2 for a, b in zip(world[0], world[-1])) ** 0.5 < 1e-9
        if closed:
            world = world[:-1]
        try:
            edge = _B3dEdge.make_spline([tuple(float(v) for v in p) for p in world], periodic=closed).wrapped
        except Exception as err:
            raise FSError(f"skFitSpline: could not fit a spline through the points ({err})")
        sk.entities.append((name, [edge], bool(m.get("construction", False))))

    self.b["skFitSpline"] = _std.Builtin("skFitSpline", sk_fit_spline)

    original_shell = self.b["opShell"]

    def op_shell(ctx, oid, m):
        ctx = _std.need_ctx(ctx)
        m = _std.need_map(m, "opShell")
        ents = _std.need_query(_std.req(m, "entities", "opShell"), "opShell", "entities").eval(ctx)
        if any(e.kind == "FACE" for e in ents):
            return original_shell.fn(ctx, oid, m)
        bodies = [e.body for e in ents if e.kind == "BODY" and e.body is not None and e.body.kind == "solid"]
        if not bodies:
            raise FSError('opShell: "entities" must resolve to faces to remove or solid bodies to hollow')
        t = _std.as_length(_std.req(m, "thickness", "opShell"), "opShell thickness")
        hists, new = [], []
        for body in bodies:
            offset = BRepOffsetAPI_MakeOffsetShape()
            offset.PerformByJoin(body.shape, -abs(t), 1e-6, BRepOffset_Skin, False, False, GeomAbs_Intersection)
            if not offset.IsDone():
                raise FSError("opShell: hollowing failed (wall too thick for the body?)")
            cut = BRepAlgoAPI_Cut(body.shape, offset.Shape())
            cut.Build()
            if not cut.IsDone():
                raise FSError("opShell: hollowing failed")
            hists.append(cut)
            new += [_G.Body(s, body.creator) for s in _G.solids_of(cut.Shape())]
        ctx.commit(oid, _std._MultiHistory(hists), new_bodies=new, removed_bodies=bodies)

    self.b["opShell"] = _std.Builtin("opShell", op_shell)


_std.StdLib._register = _register_with_extras


def build(source, name, png_dir=None):
    try:
        result = run_source(source)
    except Exception as err:  # interpreter bugs must not look like part failures
        return {"file": name, "ok": None, "error": f"local engine error: {type(err).__name__}: {err}", "line": 0}
    out = {"file": name, "ok": bool(result.ok), "error": result.error, "line": result.error_line, "seconds": round(result.seconds, 2)}
    if result.ok:
        try:
            out["metrics"] = result.metrics()
        except Exception as err:
            out["metrics"] = {"error": str(err)}
        if not out["metrics"].get("bodies"):
            out["ok"] = False
            out["error"] = "the feature ran but produced no solid body"
        elif png_dir:
            try:
                out["png"] = str(render_png(result, pathlib.Path(png_dir) / (pathlib.Path(name).stem + ".png"), name))
            except Exception as err:
                out["png_error"] = str(err)
    return out


def main():
    args = sys.argv[1:]
    png_dir = None
    if args[:1] == ["--png"]:
        png_dir, args = args[1], args[2:]
    if args == ["--stdin"]:
        print(json.dumps(build(sys.stdin.read(), "stdin", png_dir)), flush=True)
        return
    for name in args:
        print(json.dumps(build(pathlib.Path(name).read_text(encoding="utf-8"), pathlib.Path(name).name, png_dir)), flush=True)


if __name__ == "__main__":
    main()
