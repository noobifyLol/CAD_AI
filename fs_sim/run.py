"""Run a FeatureScript custom feature the way Onshape does when it is added to a Part Studio.

    python -m fs_sim.run feature.fs [--png out.png] [--json]

Every dialog parameter gets its default (bound-spec default, Default annotation,
empty query, false, first enum value), the feature's precondition is checked, and
the body runs against an OpenCascade-backed context. Reports parts, volume, size,
errors (with FeatureScript line numbers) and simulator gaps separately.
"""
import argparse
import json
import sys
import traceback

from . import parser as P
from .interp import FSError, Native, SimulatorGap
from .runtime import new_interp
from .values import EnumValue, FSMap, Tagged, fs_str, untag

INCH = 0.0254


class FeatureDef(Native):
    def __init__(self, fn, defaults):
        super().__init__("feature", self.invoke)
        self.feature_fn = fn
        self.defaults = defaults

    def invoke(self, interp, args, node):
        context, fid, definition = args
        merged = dict(untag(self.defaults).d) if isinstance(untag(self.defaults), FSMap) else {}
        merged.update(untag(definition).d)
        return interp.call(self.feature_fn, [context, fid, FSMap(merged)], node)


def install_overrides(interp):
    def define_feature(interp_, args, node):
        fn = args[0]
        defaults = args[1] if len(args) > 1 else FSMap({})
        return FeatureDef(fn, defaults)
    interp.overrides = dict(interp.overrides)
    interp.overrides["defineFeature"] = Native("defineFeature", define_feature)


def spec_default(interp, spec, node, index=1):
    """Default (index 1), minimum (0) or maximum (2) of a LengthBoundSpec / IntegerBoundSpec / RealBoundSpec / AngleBoundSpec."""
    m = untag(spec)
    if not isinstance(m, FSMap) or not m.d:
        return None
    items = list(m.d.items())
    chosen = None
    for key, triple in items:
        base = untag(key)
        if isinstance(base, FSMap):
            unit_value = base.d.get("value")
            unit_spec = untag(base.d.get("unit"))
            if isinstance(unit_spec, FSMap) and "meter" in unit_spec.d and abs(unit_value - INCH) < 1e-12:
                chosen = (key, triple)
            if isinstance(unit_spec, FSMap) and "radian" in unit_spec.d and abs(unit_value - 0.017453292519943295) < 1e-12:
                chosen = (key, triple)
    key, triple = chosen or items[0]
    values = untag(triple)
    default = values[index] if isinstance(values, tuple) and len(values) >= 3 else values
    return interp.binary("*", default, key, node)


def annotation_default(annotation):
    for key_expr, value_expr in annotation.entries if annotation is not None else []:
        if isinstance(key_expr, P.Str) and key_expr.value == "Default":
            if isinstance(value_expr, (P.Str, P.Bool, P.Num)):
                return value_expr.value
    return None


def parameter_specs(interp, feature, module):
    """{name: (kind, spec)} for every bounded numeric parameter (kind: isLength/isInteger/...)."""
    specs = {}

    def visit(stmt):
        if stmt is None:
            return
        if isinstance(stmt, P.Annotated):
            visit(stmt.stmt)
        elif isinstance(stmt, P.Block):
            for s in stmt.stmts:
                visit(s)
        elif isinstance(stmt, P.If):
            visit(stmt.then)
            visit(stmt.orelse)
        elif isinstance(stmt, P.ExprStmt):
            expr = stmt.expr
            if (isinstance(expr, P.Call) and isinstance(expr.func, P.Name) and len(expr.args) > 1
                    and is_definition_field(expr.args[0]) and expr.func.name in ("isLength", "isInteger", "isReal", "isAngle")):
                specs[expr.args[0].name] = (expr.func.name, interp.eval(expr.args[1], module.scope), expr)
    visit(feature.feature_fn.precondition)
    return specs


def build_definition(interp, feature, module):
    """Walk the feature precondition and give every parameter its Onshape default."""
    fn = feature.feature_fn
    params = {}
    env_scope = module.scope

    def visit(stmt, annotation=None):
        if stmt is None:
            return
        if isinstance(stmt, P.Annotated):
            visit(stmt.stmt, stmt.annotation)
        elif isinstance(stmt, P.Block):
            for s in stmt.stmts:
                visit(s)
        elif isinstance(stmt, P.If):
            visit(stmt.then)
            visit(stmt.orelse)
        elif isinstance(stmt, P.ExprStmt):
            expr = stmt.expr
            if isinstance(expr, P.Call) and isinstance(expr.func, P.Name) and expr.args:
                target = expr.args[0]
                if is_definition_field(target) and expr.func.name in ("isLength", "isInteger", "isReal", "isAngle", "isAnything"):
                    if len(expr.args) > 1:
                        spec = interp.eval(expr.args[1], env_scope)
                        params.setdefault(target.name, ("spec", spec, expr))
                    else:
                        params.setdefault(target.name, ("plain", expr.func.name, expr))
            elif isinstance(expr, P.IsType) and is_definition_field(expr.expr):
                params.setdefault(expr.expr.name, ("type", expr.type, annotation_default(annotation)))

    visit(fn.precondition)
    definition = {}
    for name, entry in params.items():
        kind = entry[0]
        if kind == "spec":
            definition[name] = spec_default(interp, entry[1], entry[2])
        elif kind == "plain":
            definition[name] = interp.eval(P.Binary("*", P.Num(1.0), P.Name("inch")), env_scope) if entry[1] == "isLength" else 1.0
        else:
            type_name, default = entry[1], entry[2]
            if type_name == "Query":
                definition[name] = interp.call(env_scope.lookup("qNothing"), [], None)
            elif type_name == "boolean":
                definition[name] = bool(default) if default is not None else False
            elif type_name == "string":
                definition[name] = str(default) if default is not None else ""
            elif type_name in ("map",):
                definition[name] = FSMap({})
            elif type_name in ("array",):
                definition[name] = ()
            else:
                enum = env_scope.lookup(type_name)
                values = getattr(enum, "ordered", None)
                if values:
                    definition[name] = EnumValue(type_name, default if default in values else values[0])
    return FSMap(definition)


def is_definition_field(expr):
    return isinstance(expr, P.Member) and isinstance(expr.obj, P.Name) and expr.obj.name == "definition"


def run_feature(code, feature_name=None, overrides=None, choose=None):
    """Returns a result dict; never raises for FeatureScript problems."""
    result = {"ok": False, "stage": "parse", "errors": [], "warnings": [], "gaps": [], "parts": [], "feature": None}
    try:
        interp = new_interp()
        from .geom import Context, install
        install(interp)
        install_overrides(interp)
        module = interp.load_user_module(code, "feature.fs")
    except Exception as err:  # syntax errors
        result["errors"].append(str(err))
        return result
    result["stage"] = "load"
    try:
        features = []
        for name, decl in module.consts.items():
            if name in module.exported:
                value = interp.const_value(decl, module)
                if isinstance(value, FeatureDef):
                    features.append((name, value))
        if not features:
            result["errors"].append("No exported feature (export const x = defineFeature(...)) found")
            return result
        name, feature = next(((n, f) for n, f in features if n == feature_name), features[0])
        result["feature"] = name
        result["stage"] = "parameters"
        definition = build_definition(interp, feature, module)
        if overrides:
            definition = FSMap({**definition.d, **overrides})
        if choose:
            # choose(name, kind, lo, default, hi) -> number (in the spec's units) or None
            chosen = {}
            for pname, (kind, spec, node) in parameter_specs(interp, feature, module).items():
                lo, de, hi = (spec_default(interp, spec, node, i) for i in (0, 1, 2))
                pick = choose(pname, kind, lo, de, hi)
                if pick is not None:
                    chosen[pname] = pick
            result["chosen"] = {k: fs_str(v) for k, v in chosen.items()}
            definition = FSMap({**definition.d, **chosen})
        result["definition"] = {k: fs_str(v) for k, v in definition.d.items()}
        result["stage"] = "execute"
        context = Context(interp)
        fid = Tagged(("FsimFeature1",), "Id")
        interp.call(feature, [context, fid, definition], None)
        result["ok"] = True
    except FSError as err:
        result["errors"].append(str(err))
    except SimulatorGap as err:
        result["gaps"].append(str(err))
    except RecursionError:
        result["errors"].append("Infinite recursion")
    except Exception as err:
        result["gaps"].append(f"simulator crash: {type(err).__name__}: {err}")
        result["trace"] = traceback.format_exc()[-2000:]
    result["warnings"].extend(interp.reports)
    try:
        ctx = context
    except NameError:
        return result
    from .geom import bbox, volume
    shapes = []
    for body in ctx.live_bodies():
        if body.kind == "SOLID":
            box = bbox(body.shape)
            size = [round((box[i + 3] - box[i]) / INCH, 4) for i in range(3)] if box else None
            result["parts"].append({
                "volume_in3": round(volume(body.shape) / INCH ** 3, 5),
                "size_in": size,
                "created_by": " + ".join(".".join(c) for c in body.created_by),
                "faces": len(__import__("fs_sim.geom", fromlist=["sub_shapes"]).sub_shapes(body.shape, "FACE")),
            })
            shapes.append(body.shape)
    result["sketches_left"] = sum(1 for b in ctx.live_bodies() if b.sketch is not None)
    result["_shapes"] = shapes
    if result["ok"] and not result["parts"]:
        result["warnings"].append("The feature ran but produced no solid part")
    return result


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--png")
    ap.add_argument("--stl")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    code = open(args.file, encoding="utf8").read()
    result = run_feature(code)
    shapes = result.pop("_shapes", [])
    if args.png and shapes:
        from .render import render_png
        render_png(shapes, args.png, title=result.get("feature") or "")
    if args.stl and shapes:
        from .render import write_stl
        write_stl(shapes, args.stl)
    result.pop("trace", None) if not args.json else None
    if args.json:
        print(json.dumps(result, indent=1))
    else:
        status = "OK" if result["ok"] and result["parts"] else "GAP" if result["gaps"] else "FAIL"
        print(f"{status} {result.get('feature')}: {len(result['parts'])} part(s)")
        for part in result["parts"]:
            print(f"   part {part['created_by']}: {part['volume_in3']} in^3, size {part['size_in']} in, {part['faces']} faces")
        for e in result["errors"]:
            print("   ERROR", e)
        for g in result["gaps"]:
            print("   SIMULATOR GAP", g)
        for w in result["warnings"]:
            print("   warning", w)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
