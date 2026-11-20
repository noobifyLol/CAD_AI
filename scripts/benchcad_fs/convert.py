"""BenchCAD CadQuery programs -> Onshape FeatureScript, by running each program in CadQuery with
tracing. CadQuery resolves every workplane, face selector and point pattern itself; each
operation is recorded in world coordinates and written as the matching FeatureScript call:

    box / cylinder / sphere   -> sketch + opExtrude / fCylinder / fSphere (read from the solid made)
    extrude / cutBlind        -> sketch of the profile faces + opExtrude (+ opBoolean)
    cutThruAll                -> sketch + opExtrude through everything + opBoolean SUBTRACTION
    revolve                   -> sketch + opRevolve
    hole (cutEach)            -> fCylinder cutters + opBoolean SUBTRACTION
    union / cut               -> opBoolean between the two chains' bodies
    fillet / chamfer / shell  -> opFillet / opChamfer / opShell on the same edges/faces,
                                 picked with qClosestTo at each edge's midpoint / face's center

Programs using anything else (loft, sweep, helix, sketch API, taper...) are skipped.

    .cq-venv/Scripts/python scripts/benchcad_fs/convert.py <out_dir>
writes <out_dir>/<family>#<index>.fs and <out_dir>/index.json.
"""
import gzip
import json
import math
import pathlib
import sys

import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Surface

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / ".benchcad_fs")
OUT.mkdir(parents=True, exist_ok=True)


class Unsupported(Exception):
    pass


# ── vector helpers ─────────────────────────────────────────────────────────────
def vec(p):
    if hasattr(p, "toTuple"):
        return tuple(float(v) for v in p.toTuple())
    if hasattr(p, "X"):
        return (p.X(), p.Y(), p.Z())
    return tuple(float(v) for v in p)


def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a):
    length = math.sqrt(dot(a, a))
    return mul(a, 1 / length) if length > 1e-12 else a


def num(v):
    v = round(float(v), 4)
    if abs(v) < 5e-5:
        v = 0.0
    text = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def fs_point(p):
    return f"vector({num(p[0])}, {num(p[1])}, {num(p[2])}) * u"


def fs_dir(d):
    d = norm(d)
    return f"vector({num(d[0])}, {num(d[1])}, {num(d[2])})"


def perpendicular(n):
    helper = (1, 0, 0) if abs(n[0]) < 0.9 else (0, 1, 0)
    return norm(cross(cross(n, helper), n)) if False else norm(sub(helper, mul(n, dot(helper, n))))


# ── tracing state ──────────────────────────────────────────────────────────────
class Trace:
    def __init__(self):
        self.events = []      # (chain_root, kind, data)
        self.op = None        # the Workplane method running now: {"kind", ...}
        self.depth = 0


TRACE = Trace()


def chain_root(wp):
    while getattr(wp, "parent", None) is not None:
        wp = wp.parent
    return id(wp)


def traced(name, kind=None):
    original = getattr(cq.Workplane, name)

    def wrapper(self, *args, **kwargs):
        outer = TRACE.depth == 0
        if outer:
            TRACE.op = {"kind": kind or name, "chain": chain_root(self), "plane": self.plane, "args": args, "kwargs": kwargs, "self": self}
        TRACE.depth += 1
        try:
            return original(self, *args, **kwargs)
        finally:
            TRACE.depth -= 1
            if outer:
                TRACE.op = None

    setattr(cq.Workplane, name, wrapper)


UNSUPPORTED = ["loft", "sweep", "twistExtrude", "placeSketch", "sketch", "intersect", "cskHole", "cboreHole", "text", "split", "interpPlot", "spline", "parametricCurve", "mirror"]


def refuse(name):
    def wrapper(self, *args, **kwargs):
        raise Unsupported(name)
    setattr(cq.Workplane, name, wrapper)


for _name in UNSUPPORTED:
    if hasattr(cq.Workplane, _name):
        refuse(_name)
for _name in ["box", "cylinder", "sphere", "extrude", "revolve", "hole", "cutThruAll", "fillet", "chamfer", "shell", "union", "cut"]:
    traced(_name)

_orig_get_faces = cq.Workplane._getFaces


def _get_faces(self):
    faces = _orig_get_faces(self)
    if TRACE.op is not None:
        TRACE.op.setdefault("faces", []).extend(faces)
    return faces


cq.Workplane._getFaces = _get_faces

_orig_combine = cq.Workplane._combineWithBase


def _combine(self, obj, mode=True, clean=False):
    op = TRACE.op
    if op is not None and op["kind"] in ("box", "cylinder", "sphere", "extrude", "revolve", "cutBlind"):
        shapes = list(obj) if not isinstance(obj, cq.Shape) else [obj]
        solids = [s for shape in shapes for s in (shape.Solids() if hasattr(shape, "Solids") else [shape])]
        TRACE.events.append((op["chain"], op["kind"], {**op, "solids": solids, "mode": mode}))
        op["recorded"] = True
    return _orig_combine(self, obj, mode, clean)


cq.Workplane._combineWithBase = _combine

_orig_cut_from_base = cq.Workplane._cutFromBase


def _cut_from_base(self, obj):
    op = TRACE.op
    if op is not None and op["kind"] == "cutBlind" and not op.get("recorded"):
        solids = obj.Solids() if hasattr(obj, "Solids") else [obj]
        TRACE.events.append((op["chain"], "cutBlind", {**op, "solids": solids, "mode": "cut"}))
        op["recorded"] = True
    return _orig_cut_from_base(self, obj)


cq.Workplane._cutFromBase = _cut_from_base

_orig_revolve_inner = cq.Workplane._revolve


def _revolve_inner(self, angleDegrees, axisStart, axisEnd):
    if TRACE.op is not None:
        TRACE.op["axis"] = (vec(axisStart), vec(axisEnd), float(angleDegrees))
    return _orig_revolve_inner(self, angleDegrees, axisStart, axisEnd)


cq.Workplane._revolve = _revolve_inner

_orig_extrude_inner = cq.Workplane._extrude


def _extrude_inner(self, *args, **kwargs):
    made = _orig_extrude_inner(self, *args, **kwargs)
    if TRACE.op is not None:
        TRACE.op["extruded"] = made
    return made


cq.Workplane._extrude = _extrude_inner

# cutBlind with a depth extrudes the cutter and subtracts it itself (no _cutFromBase).
_orig_cut_blind = cq.Workplane.cutBlind


def _cut_blind(self, until, clean=True, both=False, taper=None):
    if not isinstance(until, (int, float)):
        raise Unsupported("cutBlind up to a face")
    if taper:
        raise Unsupported("taper")
    TRACE.op = {"kind": "cutBlind", "chain": chain_root(self), "plane": self.plane, "args": (until,), "kwargs": {}, "self": self}
    TRACE.depth += 1
    try:
        result = _orig_cut_blind(self, until, clean=clean, both=both, taper=taper)
        made = TRACE.op.get("extruded")
        if made is None or not TRACE.op.get("faces"):
            raise Unsupported("cutBlind not traced")
        TRACE.events.append((TRACE.op["chain"], "cutBlind", {**TRACE.op, "solids": made.Solids(), "mode": "cut"}))
        return result
    finally:
        TRACE.depth -= 1
        TRACE.op = None


cq.Workplane.cutBlind = _cut_blind


def _cut_each(self, fcn, useLocalCoords=False, clean=True):
    ctx_solid = self.findSolid()
    results = list(self.eachpoint(fcn, useLocalCoords).vals())
    op = TRACE.op or {"chain": chain_root(self)}
    TRACE.events.append((op["chain"], "cutEach", {"solids": [s for r in results for s in r.Solids()], "chain": op["chain"]}))
    s = ctx_solid.cut(*results)
    if clean:
        s = s.clean()
    return self.newObject([s])


cq.Workplane.cutEach = _cut_each

_orig_cut_thru = cq.Workplane.cutThruAll


def _cut_thru_all(self, clean=True, taper=0):
    if taper:
        raise Unsupported("cutThruAll taper")
    solid = self.findSolid()
    box = solid.BoundingBox()
    faces = _orig_get_faces(self)
    TRACE.events.append((chain_root(self), "cutThruAll", {"faces": faces, "plane": self.plane, "reach": box.DiagonalLength * 1.5 + 10}))
    s = solid.dprism(None, faces, thruAll=True, additive=False, taper=0)
    if clean:
        s = s.clean()
    return self.newObject([s])


cq.Workplane.cutThruAll = _cut_thru_all


def _record_simple(kind):
    original = getattr(cq.Workplane, kind)

    def wrapper(self, *args, **kwargs):
        if kind in ("fillet", "chamfer"):
            edges = list(self.edges().vals()) if self.objects and not all(isinstance(o, cq.Edge) for o in self.objects) else [o for o in self.objects if isinstance(o, cq.Edge)]
            if not edges:
                edges = list(self.edges().vals())
            TRACE.events.append((chain_root(self), kind, {"edges": edges, "args": args, "kwargs": kwargs}))
        elif kind == "shell":
            faces = [o for o in self.objects if isinstance(o, cq.Face)]
            TRACE.events.append((chain_root(self), kind, {"faces": faces, "args": args, "kwargs": kwargs}))
        elif kind in ("union", "cut"):
            other = args[0] if args else kwargs.get("toUnion", kwargs.get("toCut"))
            if not isinstance(other, cq.Workplane):
                raise Unsupported(f"{kind} with a shape")
            TRACE.events.append((chain_root(self), kind, {"other": chain_root(other)}))
        return original(self, *args, **kwargs)

    setattr(cq.Workplane, kind, wrapper)


for _kind in ["fillet", "chamfer", "shell", "union", "cut"]:
    _record_simple(_kind)


# ── FeatureScript emission ─────────────────────────────────────────────────────
class Emitter:
    def __init__(self):
        self.lines = []
        self.count = 0
        self.prefix = {}       # chain root -> FS id expression
        self.has_solid = {}    # chain root -> bool

    def new_id(self, chain):
        self.count += 1
        return f'{self.prefix[chain]} + "o{self.count}"'

    def solids(self, chain):
        return f"qBodyType(qCreatedBy({self.prefix[chain]}, EntityType.BODY), BodyType.SOLID)"

    def emit(self, text):
        self.lines.append(text)

    def sketch_faces(self, faces, plane_hint, shift=0.0):
        """One sketch holding every profile face; returns (sketch id, plane origin, normal, x)."""
        normal = norm(vec(faces[0].normalAt()))
        origin = vec(faces[0].Center())
        x_dir = vec(plane_hint.xDir) if plane_hint is not None else perpendicular(normal)
        x_dir = sub(x_dir, mul(normal, dot(x_dir, normal)))
        x_dir = norm(x_dir) if dot(x_dir, x_dir) > 1e-9 else perpendicular(normal)
        y_dir = cross(normal, x_dir)
        origin = add(origin, mul(normal, shift))
        sid = self.new_id(self.current)
        name = f"s{self.count}"
        self.emit(f'        var {name} = newSketchOnPlane(context, {sid}, {{ "sketchPlane" : plane({fs_point(origin)}, {fs_dir(normal)}, {fs_dir(x_dir)}) }});')
        local = lambda p: (dot(sub(vec(p), origin), x_dir), dot(sub(vec(p), origin), y_dir))
        k = 0
        for face in faces:
            if abs(dot(norm(vec(face.normalAt())), normal)) < 0.999:
                raise Unsupported("profile faces not parallel")
            for wire in [face.outerWire(), *face.innerWires()]:
                for edge in wire.Edges():
                    k += 1
                    kind = edge.geomType()
                    if kind == "LINE":
                        a, b = local(edge.startPoint()), local(edge.endPoint())
                        self.emit(f'        skLineSegment({name}, "e{k}", {{ "start" : vector({num(a[0])}, {num(a[1])}) * u, "end" : vector({num(b[0])}, {num(b[1])}) * u }});')
                    elif kind == "CIRCLE":
                        if edge.IsClosed():
                            c = local(edge.arcCenter())
                            self.emit(f'        skCircle({name}, "e{k}", {{ "center" : vector({num(c[0])}, {num(c[1])}) * u, "radius" : {num(edge.radius())} * u }});')
                        else:
                            a, m, b = local(edge.startPoint()), local(edge.positionAt(0.5)), local(edge.endPoint())
                            self.emit(f'        skArc({name}, "e{k}", {{ "start" : vector({num(a[0])}, {num(a[1])}) * u, "mid" : vector({num(m[0])}, {num(m[1])}) * u, "end" : vector({num(b[0])}, {num(b[1])}) * u }});')
                    else:
                        pts = [local(edge.positionAt(t / 12)) for t in range(13)]
                        if edge.IsClosed():
                            pts = pts[:-1] + [pts[0]]
                        joined = ", ".join(f"vector({num(p[0])}, {num(p[1])}) * u" for p in pts)
                        self.emit(f'        skFitSpline({name}, "e{k}", {{ "points" : [{joined}] }});')
        self.emit(f"        skSolve({name});")
        return sid, origin, normal, x_dir

    def union_into(self, chain, made_id):
        if self.has_solid.get(chain):
            self.emit(f'        opBoolean(context, {self.new_id(chain)}, {{ "tools" : {self.solids(chain)}, "operationType" : BooleanOperationType.UNION }});')
        self.has_solid[chain] = True

    def cut_from(self, chain, tool_ids):
        tools = "qUnion([" + ", ".join(f"qCreatedBy({t}, EntityType.BODY)" for t in tool_ids) + "])"
        self.emit(f'        opBoolean(context, {self.new_id(chain)}, {{ "tools" : {tools}, "targets" : qSubtraction({self.solids(chain)}, {tools}), "operationType" : BooleanOperationType.SUBTRACTION }});')

    # -- primitives read from the solids CadQuery made --
    def box(self, solid):
        pts = [vec(v) for v in solid.Vertices()]
        normals = []
        for face in solid.Faces():
            if face.geomType() != "PLANE":
                raise Unsupported("box with curved faces")
            n = norm(vec(face.normalAt()))
            if not any(abs(abs(dot(n, m)) - 1) < 1e-6 for m in normals):
                normals.append(n)
        if len(normals) != 3 or len(pts) != 8:
            raise Unsupported("not a box")
        ax_x, ax_y = normals[0], normals[1]
        ax_z = norm(cross(ax_x, ax_y))
        extent = lambda a: (min(dot(p, a) for p in pts), max(dot(p, a) for p in pts))
        (x0, x1), (y0, y1), (z0, z1) = extent(ax_x), extent(ax_y), extent(ax_z)
        corner = add(add(mul(ax_x, x0), mul(ax_y, y0)), mul(ax_z, z0))
        sid = self.new_id(self.current)
        name = f"s{self.count}"
        self.emit(f'        var {name} = newSketchOnPlane(context, {sid}, {{ "sketchPlane" : plane({fs_point(corner)}, {fs_dir(ax_z)}, {fs_dir(ax_x)}) }});')
        self.emit(f'        skRectangle({name}, "r", {{ "firstCorner" : vector(0, 0) * u, "secondCorner" : vector({num(x1 - x0)}, {num(y1 - y0)}) * u }});')
        self.emit(f"        skSolve({name});")
        eid = self.new_id(self.current)
        self.emit(f'        opExtrude(context, {eid}, {{ "entities" : qSketchRegion({sid}), "direction" : {fs_dir(ax_z)}, "endBound" : BoundingType.BLIND, "endDepth" : {num(z1 - z0)} * u }});')
        return eid

    def cylinder(self, solid):
        cyl = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]
        if len(cyl) != 1 or len(solid.Faces()) != 3:
            raise Unsupported("not a full cylinder")
        surface = BRepAdaptor_Surface(cyl[0].wrapped).Cylinder()
        axis_pt, axis_dir, radius = vec(surface.Axis().Location()), norm(vec(surface.Axis().Direction())), surface.Radius()
        ts = [dot(sub(vec(v), axis_pt), axis_dir) for v in solid.Vertices()] or [0]
        for face in solid.Faces():
            if face.geomType() == "PLANE":
                ts.append(dot(sub(vec(face.Center()), axis_pt), axis_dir))
        bottom, top = add(axis_pt, mul(axis_dir, min(ts))), add(axis_pt, mul(axis_dir, max(ts)))
        cid = self.new_id(self.current)
        self.emit(f'        fCylinder(context, {cid}, {{ "bottomCenter" : {fs_point(bottom)}, "topCenter" : {fs_point(top)}, "radius" : {num(radius)} * u }});')
        return cid

    def sphere(self, solid):
        faces = solid.Faces()
        if len(faces) != 1 or faces[0].geomType() != "SPHERE":
            raise Unsupported("not a sphere")
        s = BRepAdaptor_Surface(faces[0].wrapped).Sphere()
        center, r = vec(s.Location()), s.Radius()
        # fSphere wants a vertex query for its center in Onshape: revolve a half disc instead.
        sid = self.new_id(self.current)
        name = f"s{self.count}"
        self.emit(f'        var {name} = newSketchOnPlane(context, {sid}, {{ "sketchPlane" : plane({fs_point(center)}, vector(0, -1, 0), vector(1, 0, 0)) }});')
        self.emit(f'        skArc({name}, "half", {{ "start" : vector(0, {num(-r)}) * u, "mid" : vector({num(r)}, 0) * u, "end" : vector(0, {num(r)}) * u }});')
        self.emit(f'        skLineSegment({name}, "axis", {{ "start" : vector(0, {num(r)}) * u, "end" : vector(0, {num(-r)}) * u }});')
        self.emit(f"        skSolve({name});")
        rid = self.new_id(self.current)
        self.emit(f'        opRevolve(context, {rid}, {{ "entities" : qSketchRegion({sid}), "axis" : line({fs_point(center)}, vector(0, 0, 1)), "angleForward" : 360 * degree }});')
        return rid

    def prism(self, faces, solids, plane):
        """Profile faces extruded into `solids`: the extent along the normal comes from the solid."""
        normal = norm(vec(faces[0].normalAt()))
        base = vec(faces[0].Center())
        ts = [dot(sub(vec(v), base), normal) for s in solids for v in s.Vertices()]
        lo, hi = min(ts), max(ts)
        if hi - lo < 1e-6:
            raise Unsupported("flat extrude")
        sid, origin, n, _ = self.sketch_faces(faces, plane, shift=lo)
        eid = self.new_id(self.current)
        self.emit(f'        opExtrude(context, {eid}, {{ "entities" : qSketchRegion({sid}, true), "direction" : {fs_dir(n)}, "endBound" : BoundingType.BLIND, "endDepth" : {num(hi - lo)} * u }});')
        return eid


def convert(code):
    TRACE.events.clear()
    scope = {}
    exec(code, scope)  # trusted: BenchCAD programs bundled in this repo
    result = scope["result"]
    final_chain = chain_root(result)
    events = list(TRACE.events)

    # Chain tree: a chain handed to union/cut belongs under the chain that consumed it.
    parent = {}
    for chain, kind, data in events:
        if kind in ("union", "cut"):
            parent[data["other"]] = chain
    em = Emitter()
    order = []
    for chain, _, data in events:
        for c in [chain, data.get("other")]:
            if c is not None and c not in order:
                order.append(c)

    def prefix_of(c, seen=()):
        if c in em.prefix:
            return em.prefix[c]
        if c in parent and parent[c] not in seen:
            em.prefix[c] = f'{prefix_of(parent[c], seen + (c,))} + "c{order.index(c)}"'
        else:
            em.prefix[c] = f'id + "c{order.index(c)}"'
        return em.prefix[c]

    for c in order:
        prefix_of(c)
    if final_chain not in em.prefix:
        raise Unsupported("result has no traced geometry")

    for chain, kind, data in events:
        em.current = chain
        if kind in ("box", "cylinder", "sphere", "extrude", "revolve", "cutBlind"):
            if data.get("kwargs", {}).get("taper") or (kind == "extrude" and len(data.get("args", ())) > 4):
                raise Unsupported("taper")
            made = []
            if kind in ("box", "cylinder", "sphere"):
                for solid in data["solids"]:
                    made.append(getattr(em, kind)(solid))
            elif kind == "revolve":
                start, end, angle = data["axis"]
                sid, origin, n, _ = em.sketch_faces(data["faces"], data["plane"])
                rid = em.new_id(chain)
                em.emit(f'        opRevolve(context, {rid}, {{ "entities" : qSketchRegion({sid}, true), "axis" : line({fs_point(start)}, {fs_dir(sub(end, start))}), "angleForward" : {num(angle)} * degree }});')
                made.append(rid)
            else:
                if not data.get("faces"):
                    raise Unsupported("extrude without faces")
                made.append(em.prism(data["faces"], data["solids"], data["plane"]))
            mode = data.get("mode", True)
            if mode in ("cut", "s"):
                em.cut_from(chain, made)
            elif mode in (True, "a"):
                em.union_into(chain, made)
            else:
                em.has_solid[chain] = True
        elif kind == "cutEach":
            made = [em.cylinder(s) for s in data["solids"]]
            em.cut_from(chain, made)
        elif kind == "cutThruAll":
            reach = data["reach"]
            sid, origin, n, _ = em.sketch_faces(data["faces"], data["plane"], shift=-reach)
            eid = em.new_id(chain)
            em.emit(f'        opExtrude(context, {eid}, {{ "entities" : qSketchRegion({sid}, true), "direction" : {fs_dir(n)}, "endBound" : BoundingType.BLIND, "endDepth" : {num(2 * reach)} * u }});')
            em.cut_from(chain, [eid])
        elif kind in ("union", "cut"):
            other = data["other"]
            if kind == "union":
                em.emit(f'        opBoolean(context, {em.new_id(chain)}, {{ "tools" : {em.solids(chain)}, "operationType" : BooleanOperationType.UNION }});')
                em.has_solid[chain] = True
            else:
                tools = em.solids(other)
                em.emit(f'        opBoolean(context, {em.new_id(chain)}, {{ "tools" : {tools}, "targets" : qSubtraction({em.solids(chain)}, {tools}), "operationType" : BooleanOperationType.SUBTRACTION }});')
        elif kind in ("fillet", "chamfer"):
            args, kwargs = data["args"], data["kwargs"]
            size = args[0] if args else kwargs.get("radius", kwargs.get("length"))
            if kind == "chamfer" and (len(args) > 1 and args[1] is not None or kwargs.get("length2")):
                raise Unsupported("two-distance chamfer")
            picks = ", ".join(f"qClosestTo(qOwnedByBody({em.solids(chain)}, EntityType.EDGE), {fs_point(vec(e.positionAt(0.5)))})" for e in data["edges"])
            if not picks:
                raise Unsupported(f"{kind} with no edges")
            fid = em.new_id(chain)
            if kind == "fillet":
                em.emit(f'        opFillet(context, {fid}, {{ "entities" : qUnion([{picks}]), "radius" : {num(size)} * u }});')
            else:
                em.emit(f'        opChamfer(context, {fid}, {{ "entities" : qUnion([{picks}]), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : {num(size)} * u }});')
        elif kind == "shell":
            args, kwargs = data["args"], data["kwargs"]
            thickness = args[0] if args else kwargs.get("thickness")
            picks = ", ".join(f"qClosestTo(qOwnedByBody({em.solids(chain)}, EntityType.FACE), {fs_point(vec(f.Center()))})" for f in data["faces"])
            if not picks:
                raise Unsupported("closed shell")
            em.emit(f'        opShell(context, {em.new_id(chain)}, {{ "entities" : qUnion([{picks}]), "thickness" : {num(thickness)} * u }});')
    return em.lines


HEADER = """FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

// {title}: a BenchCAD part (CC-BY 4.0, huggingface.co/datasets/BenchCAD/BenchCAD), converted
// from its CadQuery program. Sizes are millimeters at Scale 100 %.
annotation {{ "Feature Type Name" : "{label}" }}
export const {name} = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {{
        annotation {{ "Name" : "Scale (%)" }}
        isInteger(definition.scale, {{ (unitless) : [10, 100, 1000] }} as IntegerBoundSpec);
    }}
    {{
        var u = definition.scale / 100 * millimeter;
"""


def feature(family, variant, lines):
    label = family.replace("_", " ").title() + (f" ({variant})" if variant and variant != "standard" else "")
    name = "".join(w.capitalize() if i else w for i, w in enumerate(family.split("_"))) + "Part"
    return HEADER.format(title=label, label=label, name=name) + "\n".join(lines) + "\n    });\n"


refs = json.loads(gzip.decompress((ROOT / "data" / "benchcad_refs.json.gz").read_bytes()))["refs"]
index = {}
for i, ref in enumerate(refs):
    key = f"{ref['family']}#{i}"
    try:
        lines = convert(ref["code"])
        (OUT / f"{key.replace('#', '_')}.fs").write_text(feature(ref["family"], ref["variant"], lines), encoding="utf-8")
        index[key] = {"family": ref["family"], "variant": ref["variant"], "file": f"{key.replace('#', '_')}.fs", "ops": len(lines)}
    except Unsupported as err:
        index[key] = {"family": ref["family"], "skipped": str(err)}
    except Exception as err:  # noqa: BLE001
        index[key] = {"family": ref["family"], "error": f"{type(err).__name__}: {err}"[:200]}
(OUT / "index.json").write_text(json.dumps(index, indent=1))
done = sum(1 for v in index.values() if "file" in v)
skipped = sum(1 for v in index.values() if "skipped" in v)
print(f"{done} converted, {skipped} skipped (unsupported operations), {len(index) - done - skipped} errors")
