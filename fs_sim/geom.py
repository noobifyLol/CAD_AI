"""Geometry natives for the FeatureScript simulator, built on OpenCascade (OCP).

Models an Onshape Part Studio context: bodies (solid / sheet / wire / sketch) whose
faces, edges and vertices remember which operation created them, so queries such as
qCreatedBy, qSketchRegion and qCapEntity resolve like Onshape's. Lengths are meters,
angles radians — the same base units the std library uses inside ValueWithUnits.
"""
import itertools
import math

import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse, BRepAlgoAPI_Splitter
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeFace,
                                BRepBuilderAPI_MakeWire, BRepBuilderAPI_Transform)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakePipe, BRepOffsetAPI_MakeThickSolid, BRepOffsetAPI_ThruSections
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.BRepTools import BRepTools
from OCP.Bnd import Bnd_Box
from OCP.GC import GC_MakeArcOfCircle, GC_MakeSegment
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_Torus
from OCP.GeomAPI import GeomAPI_Interpolate
from OCP.GProp import GProp_GProps
from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds
from OCP.collections import HArray1_gp_Pnt as TColgp_HArray1OfPnt
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_IN, TopAbs_SOLID, TopAbs_VERTEX, TopAbs_WIRE
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.BRep import BRep_Builder
from OCP.collections import IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as TopTools_IndexedDataMapOfShapeListOfShape
from OCP.collections import List_TopoDS_Shape as TopTools_ListOfShape
from OCP.gp import gp_Ax1, gp_Ax2, gp_Ax3, gp_Circ, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec

from .interp import FSError, SimulatorGap
from .values import Builtin, EnumValue, FSMap, Tagged, fs_str, is_number, untag

TOL = 1e-7

# ─────────────────────────────── shape keys ───────────────────────────────


class SKey:
    """Hashable identity for a sub-shape, ignoring orientation (TopoDS IsSame)."""
    __slots__ = ("shape", "_h")

    def __init__(self, shape):
        self.shape = shape
        self._h = hash(shape)

    def __hash__(self):
        return self._h

    def __eq__(self, other):
        return isinstance(other, SKey) and self.shape.IsSame(other.shape)


SHAPE_KIND = {"FACE": TopAbs_FACE, "EDGE": TopAbs_EDGE, "VERTEX": TopAbs_VERTEX}
DOWNCAST = {"FACE": TopoDS.Face, "EDGE": TopoDS.Edge, "VERTEX": TopoDS.Vertex}


def sub_shapes(shape, kind):
    """Unique sub-shapes of a kind, in exploration order."""
    seen, out = set(), []
    explorer = TopExp_Explorer(shape, SHAPE_KIND[kind])
    while explorer.More():
        current = DOWNCAST[kind](explorer.Current())
        key = SKey(current)
        if key not in seen:
            seen.add(key)
            out.append(current)
        explorer.Next()
    return out


def solids_of(shape):
    out = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        out.append(TopoDS.Solid(explorer.Current()))
        explorer.Next()
    return out


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def area(shape):
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, props)
    return props.Mass()


def length(shape):
    props = GProp_GProps()
    BRepGProp.LinearProperties_s(shape, props)
    return props.Mass()


def bbox(shape):
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    if box.IsVoid():
        return None
    lo, hi = box.CornerMin(), box.CornerMax()
    return (lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z())


def is_valid(shape):
    return BRepCheck_Analyzer(shape).IsValid()


def make_compound(shapes):
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for shape in shapes:
        builder.Add(compound, shape)
    return compound


def list_of(shapes):
    lst = TopTools_ListOfShape()
    for shape in shapes:
        lst.Append(shape)
    return lst


# ─────────────────────────────── context model ───────────────────────────────


class EntInfo:
    """created_by is a tuple of operation ids: merges keep every creator (Onshape semantics)."""
    __slots__ = ("created_by", "cap", "sketch_id")

    def __init__(self, created_by, cap=None, sketch_id=None):
        self.created_by = as_creators(created_by)
        self.cap, self.sketch_id = cap, sketch_id

    def merged(self, other, op_id=None):
        creators = tuple(dict.fromkeys(self.created_by + other.created_by + ((op_id,) if op_id else ())))
        return EntInfo(creators, self.cap or other.cap, self.sketch_id or other.sketch_id)


def as_creators(created_by):
    """Normalize one id tuple or a tuple of id tuples to a tuple of id tuples."""
    if created_by and isinstance(created_by[0], str):
        return (tuple(created_by),)
    return tuple(tuple(c) for c in created_by)


class Body:
    _ids = itertools.count(1)

    def __init__(self, kind, shape, created_by):
        self.uid = next(Body._ids)
        self.kind = kind  # SOLID | SHEET | WIRE | POINT
        self.shape = shape
        self.created_by = as_creators(created_by)
        self.info = {}  # SKey -> EntInfo for faces/edges/vertices
        self.sketch = None
        self.alive = True

    def info_for(self, sub):
        return self.info.get(SKey(sub)) or EntInfo(self.created_by)

    def __repr__(self):
        return f"Body#{self.uid}({self.kind}, by {' + '.join('.'.join(c) for c in self.created_by)})"


class Ref:
    """One entity: a body, or a face/edge/vertex of a body."""
    __slots__ = ("kind", "body", "shape")

    def __init__(self, kind, body, shape=None):
        self.kind, self.body, self.shape = kind, body, shape

    def key(self):
        return (self.body.uid, self.kind, SKey(self.shape) if self.shape is not None else None)


class Context(Builtin):
    fs_type = "Context"

    def __init__(self, interp):
        self.interp = interp
        self.bodies = []
        self.transients = {}
        self.transient_keys = {}
        self.next_tid = itertools.count(1)
        self.sketches = []
        self.operations = []
        self.variables = {}

    def live_bodies(self):
        return [b for b in self.bodies if b.alive]

    def add_body(self, body):
        self.bodies.append(body)
        return body

    def transient_query(self, ref):
        key = ref.key()
        tid = self.transient_keys.get(key)
        if tid is None:
            tid = f"T{next(self.next_tid)}"
            self.transient_keys[key] = tid
            self.transients[tid] = ref
        return Tagged(FSMap({"queryType": EnumValue("QueryType", "TRANSIENT"), "transientId": tid}), "Query")


class SketchObj(Builtin):
    fs_type = "Sketch"

    def __init__(self, context, sid, plane):
        self.context = context
        self.id = sid
        self.plane = plane  # (origin, x, y, normal) numpy arrays, meters
        self.entities = []  # (eid, kind, data, construction)
        self.ids = set()
        self.solved = False
        self.body = None


# ─────────────────────────────── FS value conversions ───────────────────────────────


def fs_id(value):
    base = untag(value)
    if not isinstance(base, tuple):
        raise FSError(f"Expected an Id, got {fs_str(value)}")
    return tuple(str(untag(x)) for x in base)


def id_prefix(entity_id, prefix):
    return len(entity_id) >= len(prefix) and entity_id[:len(prefix)] == prefix


def created_by_any(creators, prefix):
    return any(id_prefix(c, prefix) for c in creators)


class Conv:
    """Converts between FeatureScript values and numbers/numpy (meters, radians)."""

    def __init__(self, interp):
        self.interp = interp
        units = interp.lib.modules["units.fs"]
        self.LENGTH_UNITS = interp.const_value(units.consts["LENGTH_UNITS"], units)
        self.ANGLE_UNITS = interp.const_value(units.consts["ANGLE_UNITS"], units)

    def length(self, value, what="length"):
        base = untag(value)
        if is_number(base):
            return float(base)
        if isinstance(value, Tagged) and value.tag == "ValueWithUnits":
            if value.v.d.get("unit") != self.LENGTH_UNITS:
                raise FSError(f"{what} must be a length, got {fs_str(value)}")
            return float(value.v.d["value"])
        raise FSError(f"{what} must be a length, got {fs_str(value)}")

    def angle(self, value, what="angle"):
        base = untag(value)
        if is_number(base):
            return float(base)
        if isinstance(value, Tagged) and value.tag == "ValueWithUnits":
            if value.v.d.get("unit") != self.ANGLE_UNITS:
                raise FSError(f"{what} must be an angle, got {fs_str(value)}")
            return float(value.v.d["value"])
        raise FSError(f"{what} must be an angle, got {fs_str(value)}")

    def vec(self, value, n=None, what="vector", lengths=None):
        base = untag(value)
        if not isinstance(base, tuple):
            raise FSError(f"{what} must be a vector, got {fs_str(value)}")
        if n is not None and len(base) != n:
            raise FSError(f"{what} must have {n} components")
        out = []
        for component in base:
            c = untag(component)
            if is_number(c):
                if lengths is True:
                    pass  # unit-stripped meters, as std's stripUnits produces
                out.append(float(c))
            else:
                out.append(self.length(component, what))
        return np.array(out, dtype=float)

    def make_length(self, meters):
        return Tagged(FSMap({"value": float(meters), "unit": self.LENGTH_UNITS}), "ValueWithUnits")

    def make_angle(self, radians):
        return Tagged(FSMap({"value": float(radians), "unit": self.ANGLE_UNITS}), "ValueWithUnits")

    def make_vector(self, arr, lengths=False):
        if lengths:
            return Tagged(tuple(self.make_length(x) for x in arr), "Vector")
        return Tagged(tuple(float(x) for x in arr), "Vector")

    def make_plane(self, origin, normal, x):
        return Tagged(FSMap({"origin": self.make_vector(origin, True), "normal": self.make_vector(normal), "x": self.make_vector(x)}), "Plane")

    def plane(self, value):
        m = untag(value)
        if not isinstance(m, FSMap):
            raise FSError("Expected a Plane")
        origin = self.vec(m.d["origin"], 3, "plane origin")
        normal = unit(self.vec(m.d["normal"], 3, "plane normal"))
        x = unit(self.vec(m.d["x"], 3, "plane x"))
        return origin, x, np.cross(normal, x), normal

    def line(self, value):
        m = untag(value)
        if not isinstance(m, FSMap):
            raise FSError("Expected a Line")
        return self.vec(m.d["origin"], 3, "line origin"), unit(self.vec(m.d["direction"], 3, "line direction"))

    def transform(self, value):
        m = untag(value)
        linear = [[float(untag(x)) for x in untag(row)] for row in untag(m.d["linear"])]
        translation = self.vec(m.d["translation"], 3, "translation")
        trsf = gp_Trsf()
        trsf.SetValues(linear[0][0], linear[0][1], linear[0][2], translation[0],
                       linear[1][0], linear[1][1], linear[1][2], translation[1],
                       linear[2][0], linear[2][1], linear[2][2], translation[2])
        return trsf

    def enum(self, value, default=None):
        if value is None:
            return default
        if isinstance(value, EnumValue):
            return value.name
        return str(untag(value))


def unit(v):
    n = float(np.linalg.norm(v))
    if n < 1e-15:
        raise FSError("Zero-length direction vector")
    return v / n


def P3(v):
    return gp_Pnt(float(v[0]), float(v[1]), float(v[2]))


def D3(v):
    return gp_Dir(float(v[0]), float(v[1]), float(v[2]))


def V3(v):
    return gp_Vec(float(v[0]), float(v[1]), float(v[2]))


def arg_map(interp, value, what):
    m = untag(value)
    if not isinstance(m, FSMap):
        raise FSError(f"{what}: definition must be a map")
    return m.d


# ─────────────────────────────── queries ───────────────────────────────

ENTITY_KINDS = ("BODY", "FACE", "EDGE", "VERTEX")


def all_refs(body, kinds=ENTITY_KINDS):
    out = []
    if "BODY" in kinds:
        out.append(Ref("BODY", body))
    for kind in ("FACE", "EDGE", "VERTEX"):
        if kind in kinds:
            if kind == "FACE" and body.sketch is not None:
                out.extend(Ref("FACE", body, f) for f in body.sketch.regions)
            else:
                out.extend(Ref(kind, body, s) for s in sub_shapes(body.shape, kind))
    return out


def dedupe(refs):
    seen, out = set(), []
    for ref in refs:
        key = ref.key()
        if key not in seen:
            seen.add(key)
            out.append(ref)
    return out


def ref_created_by(ref):
    if ref.kind == "BODY":
        return ref.body.created_by
    return ref.body.info_for(ref.shape).created_by


class QueryEngine:
    def __init__(self, ctx, conv):
        self.ctx = ctx
        self.conv = conv

    def eval(self, query):
        q = untag(query)
        if not isinstance(q, FSMap):
            raise FSError(f"Not a query: {fs_str(query)}")
        d = q.d
        qtype = d.get("queryType")
        name = qtype.name if isinstance(qtype, EnumValue) else str(qtype)
        method = getattr(self, "q_" + name, None)
        if method is None:
            raise SimulatorGap(f"query type {name} not implemented")
        refs = method(d)
        etype = d.get("entityType")
        if etype is not None and name not in ("OWNED_BY_PART", "CAP_ENTITY", "CREATED_BY", "EVERYTHING", "SKETCH_REGION"):
            refs = [r for r in refs if r.kind == etype.name]
        return dedupe(refs)

    def kinds(self, d):
        etype = d.get("entityType")
        return (etype.name,) if isinstance(etype, EnumValue) else ENTITY_KINDS

    def q_NOTHING(self, d):
        return []

    def q_EVERYTHING(self, d):
        kinds = self.kinds(d)
        refs = [r for b in self.ctx.live_bodies() for r in all_refs(b, kinds)]
        if d.get("bodyType") is not None:
            types = set(t.name for t in untag(d["bodyType"]))
            refs = [r for r in refs if r.body.kind in types]
        return refs

    def q_TRANSIENT(self, d):
        ref = self.ctx.transients.get(d.get("transientId"))
        if ref is None or not ref.body.alive:
            return []
        if ref.shape is not None:
            # still part of the body?
            if ref.kind == "FACE" and ref.body.sketch is not None:
                return [ref]
            if not any(s.IsSame(ref.shape) for s in sub_shapes(ref.body.shape, ref.kind)):
                return []
        return [ref]

    def q_UNION(self, d):
        out = []
        for sub in untag(d.get("subqueries") or ()):
            out.extend(self.eval(sub))
        return out

    def q_INTERSECTION(self, d):
        subs = [self.eval(s) for s in untag(d.get("subqueries") or ())]
        if not subs:
            return []
        keys = [set(r.key() for r in s) for s in subs[1:]]
        return [r for r in subs[0] if all(r.key() in k for k in keys)]

    def q_SUBTRACTION(self, d):
        remove = set(r.key() for r in self.eval(d["query2"]))
        return [r for r in self.eval(d["query1"]) if r.key() not in remove]

    def q_CREATED_BY(self, d):
        fid = fs_id(d["featureId"])
        kinds = self.kinds(d)
        out = []
        for body in self.ctx.live_bodies():
            for ref in all_refs(body, kinds):
                if created_by_any(ref_created_by(ref), fid):
                    out.append(ref)
        return out

    def q_SKETCH_REGION(self, d):
        fid = fs_id(d["featureId"])
        filter_inner = d.get("filterInnerLoops") is True
        out = []
        for sketch in self.ctx.sketches:
            if sketch.body is None or not sketch.body.alive or not id_prefix(sketch.id, fid):
                continue
            regions = sketch.outer_regions if filter_inner else sketch.regions
            out.extend(Ref("FACE", sketch.body, f) for f in regions)
        return out

    def bodies_of(self, refs):
        out, seen = [], set()
        for ref in refs:
            if ref.body.uid not in seen:
                seen.add(ref.body.uid)
                out.append(ref.body)
        return out

    def q_OWNED_BY_PART(self, d):
        kinds = self.kinds(d)
        out = []
        for body in self.bodies_of(self.eval(d["part"])):
            out.extend(all_refs(body, kinds))
        return out

    def q_OWNER_PART(self, d):
        return [Ref("BODY", b) for b in self.bodies_of(self.eval(d["query"]))]

    def q_BODY_TYPE(self, d):
        types = set(t.name for t in untag(d.get("bodyType") or d.get("bodyTypes") or ()))
        return [r for r in self.eval(d["subquery"]) if r.body.kind in types]

    def q_ENTITY_FILTER(self, d):
        return [r for r in self.eval(d["subquery"]) if r.kind == d["entityType"].name]

    def q_NTH_ELEMENT(self, d):
        refs = self.eval(d["subquery"])
        n = int(untag(d["n"]))
        return [refs[n]] if 0 <= n < len(refs) else []

    def q_CONSTRUCTION_FILTER(self, d):
        return self.eval(d["subquery"])

    def q_SKETCH_OBJECT_FILTER(self, d):
        return self.eval(d["subquery"])

    def q_MODIFIABLE_ENTITY(self, d):
        return self.eval(d["subquery"]) if "subquery" in d else []

    def q_EDGE_TOPOLOGY_FILTER(self, d):
        want = d["edgeTopologyType"].name
        out = []
        for ref in self.eval(d["subquery"]):
            if ref.kind != "EDGE":
                continue
            faces = edge_face_count(ref.body.shape, ref.shape)
            kind = "ONE_SIDED" if faces == 1 else "TWO_SIDED" if faces == 2 else "LAMINAR" if faces == 0 else "OTHER"
            if kind == want or (want == "LAMINAR" and faces == 0):
                out.append(ref)
        return out

    def q_GEOMETRY(self, d):
        want = d["geometryType"].name
        return [r for r in self.eval(d["subquery"]) if geometry_type(r) == want]

    def q_CAP_ENTITY(self, d):
        fid = fs_id(d["featureId"])
        cap = self.conv.enum(d.get("capType"), "EITHER")
        kinds = self.kinds(d) if d.get("entityType") is not None else ("FACE", "EDGE", "VERTEX")
        out = []
        for body in self.ctx.live_bodies():
            for face in sub_shapes(body.shape, "FACE"):
                info = body.info.get(SKey(face))
                if info is None or info.cap is None or not created_by_any(info.created_by, fid):
                    continue
                if cap not in ("EITHER", info.cap):
                    continue
                if "FACE" in kinds:
                    out.append(Ref("FACE", body, face))
                for kind in ("EDGE", "VERTEX"):
                    if kind in kinds:
                        out.extend(Ref(kind, body, s) for s in sub_shapes(face, kind))
        return out

    def q_LARGEST(self, d):
        refs = self.eval(d["subquery"])
        if not refs:
            return []
        sizes = [ref_size(r) for r in refs]
        best = max(sizes)
        return [r for r, s in zip(refs, sizes) if s >= best * (1 - 1e-9)]

    def q_SMALLEST(self, d):
        refs = self.eval(d["subquery"])
        if not refs:
            return []
        sizes = [ref_size(r) for r in refs]
        best = min(sizes)
        return [r for r, s in zip(refs, sizes) if s <= best * (1 + 1e-9)]


def edge_face_count(body_shape, edge):
    mapping = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(body_shape, TopAbs_EDGE, TopAbs_FACE, mapping)
    index = mapping.FindIndex(edge)
    if index == 0:
        return 0
    faces = mapping.FindFromIndex(index)
    unique = []
    for face in faces:
        if not any(face.IsSame(u) for u in unique):
            unique.append(face)
    return len(unique)


def geometry_type(ref):
    if ref.kind == "FACE":
        t = BRepAdaptor_Surface(ref.shape).GetType()
        return {GeomAbs_Plane: "PLANE", GeomAbs_Cylinder: "CYLINDER", GeomAbs_Cone: "CONE", GeomAbs_Sphere: "SPHERE", GeomAbs_Torus: "TORUS"}.get(t, "OTHER")
    if ref.kind == "EDGE":
        curve = BRepAdaptor_Curve(ref.shape)
        t = curve.GetType()
        if t == GeomAbs_Line:
            return "LINE"
        if t == GeomAbs_Circle:
            return "CIRCLE" if curve.IsClosed() else "ARC"
        return "OTHER"
    return "OTHER"


def ref_size(ref):
    if ref.kind == "BODY":
        return volume(ref.body.shape) if ref.body.kind == "SOLID" else area(ref.body.shape)
    if ref.kind == "FACE":
        return area(ref.shape)
    if ref.kind == "EDGE":
        return length(ref.shape)
    return 0.0


# ─────────────────────────────── provenance ───────────────────────────────


def inherit_info(builder, inputs, result_shape, op_id, has_history=True):
    """Info for every face/edge/vertex of result_shape: inherited through OCC history, else created by op_id."""
    carried = {}
    for body in inputs:
        for kind in ("FACE", "EDGE", "VERTEX"):
            for sub in sub_shapes(body.shape, kind):
                info = body.info_for(sub)
                if has_history:
                    try:
                        modified = builder.Modified(sub)
                        if modified.Size() > 0:
                            for m in modified:
                                key = SKey(m)
                                carried[key] = carried[key].merged(info, op_id) if key in carried else info
                            continue
                        if builder.IsDeleted(sub):
                            continue
                    except Exception:
                        pass
                carried.setdefault(SKey(sub), info)
    new_info = {}
    for kind in ("FACE", "EDGE", "VERTEX"):
        for sub in sub_shapes(result_shape, kind):
            key = SKey(sub)
            new_info[key] = carried.get(key) or EntInfo(op_id)
    return new_info


def single_info(shape, op_id, caps=None):
    info = {}
    for kind in ("FACE", "EDGE", "VERTEX"):
        for sub in sub_shapes(shape, kind):
            info[SKey(sub)] = EntInfo(op_id)
    for cap, faces in (caps or {}).items():
        for face in faces:
            for sub in [face] + sub_shapes(face, "EDGE") + sub_shapes(face, "VERTEX"):
                if sub.ShapeType() == TopAbs_FACE:
                    info[SKey(sub)] = EntInfo(op_id, cap)
    return info


# ─────────────────────────────── sketches ───────────────────────────────


def sketch_point(conv, sk, value, what):
    uv = conv.vec(value, 2, what)
    origin, x, y, _ = sk.plane
    return origin + uv[0] * x + uv[1] * y


def interior_point(face):
    BRepMesh_IncrementalMesh(face, 1e-4, False, 0.3, True)
    location = TopLoc_Location()
    triangulation = BRep_Tool.Triangulation_s(face, location)
    if triangulation is None or triangulation.NbTriangles() == 0:
        return None
    trsf = location.Transformation()
    best, best_area = None, -1
    for i in range(1, triangulation.NbTriangles() + 1):
        a, b, c = triangulation.Triangle(i).Get()
        pa, pb, pc = (triangulation.Node(k).Transformed(trsf) for k in (a, b, c))
        va = np.array([pa.X(), pa.Y(), pa.Z()])
        vb = np.array([pb.X(), pb.Y(), pb.Z()])
        vc = np.array([pc.X(), pc.Y(), pc.Z()])
        tri_area = np.linalg.norm(np.cross(vb - va, vc - va))
        if tri_area > best_area:
            best, best_area = (va + vb + vc) / 3, tri_area
    return best


def solve_sketch(interp, sk):
    origin, x, y, normal = sk.plane
    edges = []
    for eid, kind, data, construction in sk.entities:
        if construction or kind == "point":
            continue
        try:
            if kind == "line":
                p1, p2 = data
                if np.linalg.norm(p2 - p1) < 1e-9:
                    raise FSError(f"Sketch line {eid} has zero length")
                edge = BRepBuilderAPI_MakeEdge(GC_MakeSegment(P3(p1), P3(p2)).Value()).Edge()
            elif kind == "circle":
                center, radius = data
                edge = BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(P3(center), D3(normal), D3(x)), radius)).Edge()
            elif kind == "arc":
                p1, pm, p2 = data
                if np.linalg.norm(np.cross(pm - p1, p2 - p1)) < 1e-12:
                    raise FSError(f"Sketch arc {eid}: start, mid and end points are collinear")
                edge = BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(P3(p1), P3(pm), P3(p2)).Value()).Edge()
            elif kind == "spline":
                points, closed = data
                arr = TColgp_HArray1OfPnt(1, len(points))
                for i, p in enumerate(points):
                    arr.SetValue(i + 1, P3(p))
                interp_curve = GeomAPI_Interpolate(arr, bool(closed), 1e-9)
                interp_curve.Perform()
                if not interp_curve.IsDone():
                    raise FSError(f"Sketch spline {eid} could not be fitted")
                edge = BRepBuilderAPI_MakeEdge(interp_curve.Curve()).Edge()
            elif kind == "ellipse":
                from OCP.gp import gp_Elips
                center, major, minor, axis = data
                edge = BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(P3(center), D3(normal), D3(axis)), major, minor)).Edge()
            else:
                raise SimulatorGap(f"sketch entity kind {kind}")
        except FSError:
            raise
        except SimulatorGap:
            raise
        except Exception as err:
            raise FSError(f"Sketch entity {eid} is invalid ({err})")
        edges.append((eid, edge))

    regions = []
    if edges:
        box = bbox(make_compound([e for _, e in edges]))
        corners = np.array([[box[0], box[1], box[2]], [box[3], box[4], box[5]]])
        span = float(np.max(corners[1] - corners[0])) + 1e-3
        uvs = [((c - origin) @ x, (c - origin) @ y) for c in
               [np.array([cx, cy, cz]) for cx in corners[:, 0] for cy in corners[:, 1] for cz in corners[:, 2]]]
        umin, umax = min(u for u, _ in uvs) - span, max(u for u, _ in uvs) + span
        vmin, vmax = min(v for _, v in uvs) - span, max(v for _, v in uvs) + span
        pln = gp_Pln(gp_Ax3(P3(origin), D3(normal), D3(x)))
        big = BRepBuilderAPI_MakeFace(pln, umin, umax, vmin, vmax).Face()
        splitter = BRepAlgoAPI_Splitter()
        splitter.SetArguments(list_of([big]))
        splitter.SetTools(list_of([e for _, e in edges]))
        splitter.SetFuzzyValue(1e-9)
        splitter.Build()
        if not splitter.IsDone():
            raise FSError("Sketch regions could not be computed (curves may be invalid)")
        margin = 1e-6 * max(1.0, span)
        for face in sub_shapes(splitter.Shape(), "FACE"):
            us, vs = [], []
            for edge in sub_shapes(face, "EDGE"):
                curve = BRepAdaptor_Curve(edge)
                for i in range(5):
                    t = curve.FirstParameter() + (curve.LastParameter() - curve.FirstParameter()) * i / 4
                    p = curve.Value(t)
                    q = np.array([p.X(), p.Y(), p.Z()]) - origin
                    us.append(q @ x)
                    vs.append(q @ y)
            touches = min(us) <= umin + margin or max(us) >= umax - margin or min(vs) <= vmin + margin or max(vs) >= vmax - margin
            if not touches:
                regions.append(face)

    # Regions sitting inside another region's hole are dropped by qSketchRegion(id, true).
    pln = gp_Pln(gp_Ax3(P3(origin), D3(normal), D3(x)))
    holes = []
    for face in regions:
        outer = BRepTools.OuterWire_s(face)
        for wire in sub_wires(face):
            if not wire.IsSame(outer):
                holes.append(BRepBuilderAPI_MakeFace(pln, wire).Face())
    outer_regions = []
    for face in regions:
        point = interior_point(face)
        inside_hole = False
        if point is not None:
            for hole in holes:
                classifier = BRepClass_FaceClassifier(hole, P3(point), 1e-7)
                if classifier.State() == TopAbs_IN:
                    inside_hole = True
                    break
        if not inside_hole:
            outer_regions.append(face)

    body = Body("WIRE", make_compound([e for _, e in edges]), sk.id)
    body.sketch = sk
    sk.regions, sk.outer_regions = regions, outer_regions
    for face in regions:
        body.info[SKey(face)] = EntInfo(sk.id)
    sk.body = body
    sk.context.add_body(body)
    sk.solved = True


def sub_wires(face):
    out = []
    explorer = TopExp_Explorer(face, TopAbs_WIRE)
    while explorer.More():
        out.append(TopoDS.Wire(explorer.Current()))
        explorer.Next()
    return out


# ─────────────────────────────── natives ───────────────────────────────


class Geom:
    """Holds per-interpreter helpers; natives are bound methods."""

    def __init__(self, interp):
        self.interp = interp
        self.conv = Conv(interp)

    def ctx(self, value):
        if not isinstance(value, Context):
            raise FSError("Expected a Context")
        return value

    def query(self, ctx, value):
        return QueryEngine(ctx, self.conv).eval(value)

    # ── context / misc ──
    def n_isContext(self, interp, args, node):
        return isinstance(args[0], Context)

    def n_isSketch(self, interp, args, node):
        return isinstance(args[0], SketchObj)

    def n_newContext(self, interp, args, node):
        return Context(interp)

    def n_noop(self, interp, args, node):
        return None

    def n_reportFeatureStatus(self, interp, args, node):
        status = untag(args[-1]) if args else None
        if isinstance(status, FSMap):
            kind = self.conv.enum(status.d.get("statusType"), "")
            message = status.d.get("statusMsg") or self.conv.enum(status.d.get("statusEnum"), "")
            if kind in ("WARNING", "ERROR", "INFO"):
                interp.reports.append(f"{kind.lower()}: {message}")
        return None

    def n_false(self, interp, args, node):
        return False

    def n_setVariable(self, interp, args, node):
        ctx = self.ctx(args[0])
        d = arg_map(interp, args[1], "setVariable")
        ctx.variables[str(d.get("name"))] = d.get("value")
        return None

    def n_getVariable(self, interp, args, node):
        ctx = self.ctx(args[0])
        d = arg_map(interp, args[1], "getVariable")
        name = str(d.get("name"))
        if name not in ctx.variables:
            raise FSError(f"Variable #{name} not found")
        return ctx.variables[name]

    # ── sketch ──
    def n_newSketch(self, interp, args, node):
        ctx = self.ctx(args[0])
        sid = fs_id(args[1])
        d = arg_map(interp, args[2], "newSketch")
        if "sketchPlane" not in d:
            raise FSError("newSketch needs a sketchPlane")
        origin, x, y, normal = self.conv.plane(d["sketchPlane"])
        if any(id_prefix(s.id, sid) and s.id == sid for s in ctx.sketches):
            raise FSError(f"Duplicate operation id {'.'.join(sid)}")
        sk = SketchObj(ctx, sid, (origin, x, y, normal))
        ctx.sketches.append(sk)
        ctx.operations.append(("newSketch", sid))
        return sk

    def add_entity(self, sk, eid, kind, data, construction):
        if not isinstance(sk, SketchObj):
            raise FSError("Expected a Sketch")
        if sk.solved:
            raise FSError(f"Cannot add {eid}: the sketch has already been solved")
        eid = str(untag(eid))
        if eid in sk.ids:
            raise FSError(f"Sketch entity id \"{eid}\" is used more than once in the same sketch")
        sk.ids.add(eid)
        sk.entities.append((eid, kind, data, construction is True))

    def n_skLineSegment(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skLineSegment")
        p1 = sketch_point(self.conv, sk, d.get("start"), "line start")
        p2 = sketch_point(self.conv, sk, d.get("end"), "line end")
        self.add_entity(sk, eid, "line", (p1, p2), d.get("construction"))
        return None

    def n_skCircle(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skCircle")
        center = sketch_point(self.conv, sk, d.get("center"), "circle center")
        radius = self.conv.length(d.get("radius"), "circle radius")
        if radius <= 0:
            raise FSError(f"Circle {untag(eid)} radius must be positive")
        self.add_entity(sk, eid, "circle", (center, radius), d.get("construction"))
        return None

    def n_skArc(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skArc")
        pts = tuple(sketch_point(self.conv, sk, d.get(k), f"arc {k}") for k in ("start", "mid", "end"))
        self.add_entity(sk, eid, "arc", pts, d.get("construction"))
        return None

    def n_skFitSpline(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skFitSpline")
        points = [sketch_point(self.conv, sk, p, "spline point") for p in untag(d.get("points") or ())]
        if len(points) < 2:
            raise FSError(f"Spline {untag(eid)} needs at least 2 points")
        self.add_entity(sk, eid, "spline", (points, d.get("closed") is True), d.get("construction"))
        return None

    def n_skEllipse(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skEllipse")
        center = sketch_point(self.conv, sk, d.get("center"), "ellipse center")
        major = self.conv.length(d.get("majorRadius"))
        minor = self.conv.length(d.get("minorRadius"))
        axis2 = self.conv.vec(d["majorAxis"], 2) if d.get("majorAxis") is not None else np.array([1.0, 0.0])
        _, x, y, _ = sk.plane
        self.add_entity(sk, eid, "ellipse", (center, major, minor, unit(axis2[0] * x + axis2[1] * y)), d.get("construction"))
        return None

    def n_skPoint(self, interp, args, node):
        sk, eid, d = args[0], args[1], arg_map(interp, args[2], "skPoint")
        self.add_entity(sk, eid, "point", sketch_point(self.conv, sk, d.get("position"), "point"), False)
        return None

    def n_skSolve(self, interp, args, node):
        sk = args[0]
        if not isinstance(sk, SketchObj):
            raise FSError("skSolve expects a Sketch")
        if sk.solved:
            raise FSError("Sketch was already solved")
        solve_sketch(interp, sk)
        return None

    # ── queries / evaluation ──
    def n_evaluateQuery(self, interp, args, node):
        ctx = self.ctx(args[0])
        refs = self.query(ctx, arg_map(interp, args[1], "evaluateQuery")["query"])
        return tuple(ctx.transient_query(r) for r in refs)

    def n_evaluateQueryCount(self, interp, args, node):
        ctx = self.ctx(args[0])
        return float(len(self.query(ctx, arg_map(interp, args[1], "evaluateQueryCount")["query"])))

    def n_isQueryEmpty(self, interp, args, node):
        ctx = self.ctx(args[0])
        return len(self.query(ctx, arg_map(interp, args[1], "isQueryEmpty")["query"])) == 0

    def single_face(self, ctx, query, what):
        refs = [r for r in self.query(ctx, query) if r.kind == "FACE"]
        if not refs:
            raise FSError(f"{what}: no face selected")
        return refs[0]

    def n_evPlane(self, interp, args, node):
        ctx = self.ctx(args[0])
        ref = self.single_face(ctx, arg_map(interp, args[1], "evPlane")["face"], "evPlane")
        surface = BRepAdaptor_Surface(ref.shape)
        if surface.GetType() != GeomAbs_Plane:
            raise FSError("evPlane: the selected face is not planar")
        pln = surface.Plane()
        position = pln.Position()
        normal = np.array([position.Direction().X(), position.Direction().Y(), position.Direction().Z()])
        x = np.array([position.XDirection().X(), position.XDirection().Y(), position.XDirection().Z()])
        if ref.shape.Orientation() == 1:  # REVERSED: outward normal is opposite
            normal = -normal
        props = GProp_GProps()
        BRepGProp.SurfaceProperties_s(ref.shape, props)
        c = props.CentreOfMass()
        return self.conv.make_plane(np.array([c.X(), c.Y(), c.Z()]), normal, x)

    def n_evOwnerSketchPlane(self, interp, args, node):
        ctx = self.ctx(args[0])
        refs = self.query(ctx, arg_map(interp, args[1], "evOwnerSketchPlane")["entity"])
        for ref in refs:
            if ref.body.sketch is not None:
                o, x, _, n = ref.body.sketch.plane
                return self.conv.make_plane(o, n, x)
        raise FSError("evOwnerSketchPlane: entity is not in a sketch")

    def measure(self, interp, args, fn, what):
        ctx = self.ctx(args[0])
        refs = self.query(ctx, arg_map(interp, args[1], what)["entities"])
        if not refs:
            raise FSError(f"{what}: no entities")
        return sum(fn(r) for r in refs)

    def n_evVolume(self, interp, args, node):
        return self.conv.make_length(1) and Tagged(FSMap({"value": self.measure(interp, args, lambda r: volume(r.body.shape), "evVolume"),
                                                          "unit": Tagged(FSMap({"meter": 3.0}), "UnitSpec")}), "ValueWithUnits")

    def n_evArea(self, interp, args, node):
        return Tagged(FSMap({"value": self.measure(interp, args, lambda r: area(r.shape if r.shape is not None else r.body.shape), "evArea"),
                             "unit": Tagged(FSMap({"meter": 2.0}), "UnitSpec")}), "ValueWithUnits")

    def n_evLength(self, interp, args, node):
        return self.conv.make_length(self.measure(interp, args, lambda r: length(r.shape if r.shape is not None else r.body.shape), "evLength"))

    def n_evBox(self, interp, args, node):
        ctx = self.ctx(args[0])
        d = arg_map(interp, args[1], "evBox")
        refs = self.query(ctx, d["topology"])
        if not refs:
            raise FSError("evBox: nothing selected")
        box = bbox(make_compound([r.shape if r.shape is not None else r.body.shape for r in refs]))
        return Tagged(FSMap({"minCorner": self.conv.make_vector(box[:3], True), "maxCorner": self.conv.make_vector(box[3:], True)}), "Box3d")

    def n_evEdgeCurvatures(self, interp, args, node):
        from OCP.BRepLProp import BRepLProp_CLProps
        ctx = self.ctx(args[0])
        d = arg_map(interp, args[1], "evEdgeCurvatures")
        edges = [r for r in self.query(ctx, d["edge"]) if r.kind == "EDGE"]
        if len(edges) != 1:
            raise FSError(f"evEdgeCurvatures: expected one edge, got {len(edges)}")
        curve = BRepAdaptor_Curve(edges[0].shape)
        first, last = curve.FirstParameter(), curve.LastParameter()
        out = []
        for t in untag(d.get("parameters") or ()):
            u = first + (last - first) * float(untag(t))
            props = BRepLProp_CLProps(curve, u, 2, 1e-9)
            k = props.Curvature() if props.IsTangentDefined() else 0.0
            p = props.Value()
            tangent = gp_Dir()
            props.Tangent(tangent)
            tan = np.array([tangent.X(), tangent.Y(), tangent.Z()])
            if k > 1e-12:
                normal_dir = gp_Dir()
                props.Normal(normal_dir)
                nrm = np.array([normal_dir.X(), normal_dir.Y(), normal_dir.Z()])
            else:
                helper = np.array([0.0, 0.0, 1.0]) if abs(tan[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
                nrm = unit(np.cross(tan, helper))
            frame = Tagged(FSMap({"origin": self.conv.make_vector([p.X(), p.Y(), p.Z()], True),
                                  "xAxis": self.conv.make_vector(nrm), "zAxis": self.conv.make_vector(tan)}), "CoordSystem")
            curvature = Tagged(FSMap({"value": float(k), "unit": Tagged(FSMap({"meter": -1.0}), "UnitSpec")}), "ValueWithUnits")
            out.append(Tagged(FSMap({"frame": frame, "curvature": curvature}), "EdgeCurvatureResult"))
        return tuple(out)

    # ── operations ──
    def begin_op(self, ctx, op_id, name):
        if any(entry[1] == op_id for entry in ctx.operations):
            raise FSError(f"{name}: operation id {'.'.join(op_id)} is already used")
        ctx.operations.append((name, op_id))

    def bodies_from(self, ctx, query, what, solid_only=True):
        bodies = []
        for ref in self.query(ctx, query):
            if ref.body not in bodies:
                bodies.append(ref.body)
        if solid_only:
            bad = [b for b in bodies if b.kind != "SOLID"]
            if bad:
                raise FSError(f"{what}: expected solid bodies, got {bad[0].kind.lower()} body ({'.'.join(bad[0].created_by[0])})")
        return bodies

    def add_solids(self, ctx, shape, op_id, info):
        bodies = []
        for solid in solids_of(shape):
            body = Body("SOLID", solid, op_id)
            body.info = {k: v for k, v in info.items()}
            ctx.add_body(body)
            bodies.append(body)
        return bodies

    def n_opExtrude(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opExtrude")
        self.begin_op(ctx, op_id, "opExtrude")
        refs = self.query(ctx, d.get("entities"))
        faces = [r for r in refs if r.kind == "FACE"]
        if not faces:
            raise FSError("opExtrude: no faces or sketch regions selected (EXTRUDE_NO_SELECTED_REGION)" if not refs
                          else "opExtrude: only edges selected; surface extrudes are not simulated")
        direction = unit(self.conv.vec(d.get("direction"), 3, "direction"))
        end_bound = self.conv.enum(d.get("endBound"), "BLIND")
        if end_bound != "BLIND":
            raise SimulatorGap(f"opExtrude endBound {end_bound}")
        end = self.conv.length(d.get("endDepth"), "endDepth")
        start = 0.0
        if d.get("startBound") is not None and self.conv.enum(d.get("startBound")) == "BLIND" and d.get("startDepth") is not None:
            start = self.conv.length(d.get("startDepth"), "startDepth")
        total = end + start
        if abs(total) < 1e-9:
            raise FSError("opExtrude: extrude depth is zero")
        prisms, caps = [], {"START": [], "END": []}
        for ref in faces:
            n = face_normal(ref.shape)
            if n is not None and abs(float(n @ direction)) < 1e-9:
                raise FSError("opExtrude: the extrude direction lies in the plane of the selected face")
            face = ref.shape
            if abs(start) > 1e-12:
                trsf = gp_Trsf()
                trsf.SetTranslation(V3(-direction * start))
                face = BRepBuilderAPI_Transform(face, trsf, True).Shape()
            prism = BRepPrimAPI_MakePrism(face, V3(direction * total))
            prism.Build()
            if not prism.IsDone():
                raise FSError("opExtrude failed")
            prisms.append(prism.Shape())
            caps["START"].append(prism.FirstShape())
            caps["END"].append(prism.LastShape())
        shape = prisms[0]
        info = single_info(shape, op_id, caps)
        if len(prisms) > 1:
            fuse = BRepAlgoAPI_Fuse()
            fuse.SetArguments(list_of(prisms[:1]))
            fuse.SetTools(list_of(prisms[1:]))
            fuse.Build()
            if not fuse.IsDone():
                raise FSError("opExtrude: could not merge the extruded regions")
            temp = Body("SOLID", make_compound(prisms), op_id)
            temp.info = single_info(make_compound(prisms), op_id, caps)
            shape = fuse.Shape()
            info = inherit_info(fuse, [temp], shape, op_id)
            shape, info = unify_faces(shape, info, op_id)
        if not is_valid(shape):
            raise FSError("opExtrude produced invalid geometry")
        self.add_solids(ctx, shape, op_id, info)
        return None

    def n_opRevolve(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opRevolve")
        self.begin_op(ctx, op_id, "opRevolve")
        faces = [r for r in self.query(ctx, d.get("entities")) if r.kind == "FACE"]
        if not faces:
            raise FSError("opRevolve: no faces or sketch regions selected")
        origin, direction = self.conv.line(d.get("axis"))
        forward = self.conv.angle(d.get("angleForward"), "angleForward") if d.get("angleForward") is not None else 2 * math.pi
        back = self.conv.angle(d.get("angleBack"), "angleBack") if d.get("angleBack") is not None else 0.0
        total = forward + back
        if total <= 1e-9:
            raise FSError("opRevolve: revolve angle is zero")
        full = total >= 2 * math.pi - 1e-9
        shapes, caps = [], {"START": [], "END": []}
        for ref in faces:
            check_axis_side(ref.shape, origin, direction)
            face = ref.shape
            if back > 1e-12 and not full:
                trsf = gp_Trsf()
                trsf.SetRotation(gp_Ax1(P3(origin), D3(direction)), -back)
                face = BRepBuilderAPI_Transform(face, trsf, True).Shape()
            revol = BRepPrimAPI_MakeRevol(face, gp_Ax1(P3(origin), D3(direction)), 2 * math.pi if full else total)
            revol.Build()
            if not revol.IsDone():
                raise FSError("opRevolve failed")
            shapes.append(revol.Shape())
            if not full:
                caps["START"].append(revol.FirstShape())
                caps["END"].append(revol.LastShape())
        shape = shapes[0] if len(shapes) == 1 else fuse_all(shapes)
        if not is_valid(shape) or volume(shape) <= 0:
            raise FSError("opRevolve produced invalid geometry (does the region cross the axis?)")
        self.add_solids(ctx, shape, op_id, single_info(shape, op_id, caps))
        return None

    def n_opLoft(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opLoft")
        self.begin_op(ctx, op_id, "opLoft")
        if d.get("guideSubqueries"):
            raise SimulatorGap("opLoft guides")
        solid = self.conv.enum(d.get("bodyType"), "SOLID") == "SOLID"
        loft = BRepOffsetAPI_ThruSections(solid, False, 1e-6)
        count = 0
        for sub in untag(d.get("profileSubqueries") or ()):
            refs = self.query(ctx, sub)
            faces = [r for r in refs if r.kind == "FACE"]
            vertices = [r for r in refs if r.kind == "VERTEX"]
            edges = [r for r in refs if r.kind == "EDGE"]
            if faces:
                if len(faces) > 1:
                    raise FSError("opLoft: each profile must be a single region or face")
                loft.AddWire(BRepTools.OuterWire_s(faces[0].shape))
            elif edges:
                wire = BRepBuilderAPI_MakeWire()
                for e in edges:
                    wire.Add(e.shape)
                loft.AddWire(wire.Wire())
            elif vertices:
                loft.AddVertex(vertices[0].shape)
            else:
                raise FSError("opLoft: a profile query is empty")
            count += 1
        if count < 2:
            raise FSError("opLoft needs at least two profiles")
        loft.Build()
        if not loft.IsDone():
            raise FSError("opLoft failed")
        shape = loft.Shape()
        if solid and (not is_valid(shape) or volume(shape) <= 0):
            raise FSError("opLoft produced invalid geometry")
        caps = {"START": [loft.FirstShape()], "END": [loft.LastShape()]}
        self.add_solids(ctx, shape, op_id, single_info(shape, op_id, caps))
        return None

    def n_opSweep(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opSweep")
        self.begin_op(ctx, op_id, "opSweep")
        faces = [r for r in self.query(ctx, d.get("profiles")) if r.kind == "FACE"]
        path_edges = [r.shape for r in self.query(ctx, d.get("path")) if r.kind == "EDGE"]
        if not faces:
            raise FSError("opSweep: no profile faces selected")
        if not path_edges:
            raise FSError("opSweep: no path edges selected")
        wire = connect_edges(path_edges)
        shapes, caps = [], {"START": [], "END": []}
        for ref in faces:
            pipe = BRepOffsetAPI_MakePipe(wire, ref.shape)
            pipe.Build()
            if not pipe.IsDone():
                raise FSError("opSweep failed")
            shapes.append(pipe.Shape())
            caps["START"].append(pipe.FirstShape())
            caps["END"].append(pipe.LastShape())
        shape = shapes[0] if len(shapes) == 1 else fuse_all(shapes)
        if not is_valid(shape) or volume(shape) <= 0:
            raise FSError("opSweep produced invalid geometry (profile too large for the path's bends?)")
        self.add_solids(ctx, shape, op_id, single_info(shape, op_id, caps))
        return None

    def n_opBoolean(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opBoolean")
        self.begin_op(ctx, op_id, "opBoolean")
        op = self.conv.enum(d.get("operationType"))
        tools = self.bodies_from(ctx, d.get("tools"), "opBoolean tools")
        if not tools:
            raise FSError("opBoolean: no tool bodies selected (BOOLEAN_NEED_ONE_SOLID)")
        keep_tools = d.get("keepTools") is True
        if op == "UNION":
            # Onshape-verified: UNION takes every body in "tools"; passing "targets"
            # fails with BOOLEAN_BAD_INPUT in the real kernel.
            if d.get("targets") is not None and self.query(ctx, d["targets"]):
                raise FSError("opBoolean UNION must not have \"targets\"; put all bodies in \"tools\" (BOOLEAN_BAD_INPUT)")
            if len(tools) < 2:
                ctx.interp.reports.append("opBoolean UNION with a single body (no-op)")
                return None
            fuse = BRepAlgoAPI_Fuse()
            fuse.SetArguments(list_of([tools[0].shape]))
            fuse.SetTools(list_of([t.shape for t in tools[1:]]))
            fuse.Build()
            if not fuse.IsDone():
                raise FSError("opBoolean UNION failed")
            self.replace_bodies(ctx, fuse, tools, fuse.Shape(), op_id, merge_creators=True)
            return None
        if op == "SUBTRACTION":
            targets = self.bodies_from(ctx, d.get("targets"), "opBoolean targets")
            if not targets:
                raise FSError("opBoolean SUBTRACTION: no target bodies selected")
            overlap = set(t.uid for t in targets) & set(t.uid for t in tools)
            if overlap:
                raise FSError("opBoolean SUBTRACTION: a body cannot be both a tool and a target")
            tool_shape = make_compound([t.shape for t in tools])
            for target in targets:
                cut = BRepAlgoAPI_Cut()
                cut.SetArguments(list_of([target.shape]))
                cut.SetTools(list_of([tool_shape]))
                cut.Build()
                if not cut.IsDone():
                    raise FSError("opBoolean SUBTRACTION failed")
                self.replace_bodies(ctx, cut, [target] + tools, cut.Shape(), op_id, owners=[target])
            if not keep_tools:
                for tool in tools:
                    tool.alive = False
            return None
        if op == "INTERSECTION":
            if len(tools) < 2:
                raise FSError("opBoolean INTERSECTION needs at least two bodies")
            shape = tools[0].shape
            history = None
            for other in tools[1:]:
                common = BRepAlgoAPI_Common(shape, other.shape)
                common.Build()
                if not common.IsDone():
                    raise FSError("opBoolean INTERSECTION failed")
                shape, history = common.Shape(), common
            if volume(shape) <= 1e-18:
                raise FSError("opBoolean INTERSECTION: the bodies do not overlap")
            self.replace_bodies(ctx, history, tools, shape, op_id, owners=[tools[0]], merge_creators=True)
            for tool in tools[1:]:
                tool.alive = False
            return None
        raise SimulatorGap(f"opBoolean operationType {op}")

    def replace_bodies(self, ctx, builder, inputs, shape, op_id, owners=None, merge_creators=False):
        """Result solids replace `owners` (default: all inputs); the first owner keeps its identity."""
        owners = owners if owners is not None else inputs
        info = inherit_info(builder, inputs, shape, op_id)
        shape, info = unify_faces(shape, info, op_id)
        solids = solids_of(shape)
        for body in owners:
            body.alive = False
        if not solids:
            ctx.interp.reports.append(f"{'.'.join(op_id)}: boolean removed the whole body")
            return
        merging = merge_creators
        all_creators = tuple(dict.fromkeys(c for b in owners for c in b.created_by))
        for index, solid in enumerate(solids):
            if index < len(owners):
                body = owners[index]
                body.alive = True
                body.shape = solid
                if merging:
                    body.created_by = all_creators + ((op_id,) if op_id not in all_creators else ())
                elif len(solids) > 1:
                    body.created_by = body.created_by + (op_id,)  # split: original creator + splitting op
            else:
                body = ctx.add_body(Body("SOLID", solid, (owners[0].created_by + (op_id,)) if owners else op_id))
            body.info = {SKey(s): info.get(SKey(s), EntInfo(op_id)) for kind in ("FACE", "EDGE", "VERTEX") for s in sub_shapes(solid, kind)}
        if not is_valid(shape):
            raise FSError(f"{'.'.join(op_id)}: boolean produced invalid geometry")

    def n_opPattern(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opPattern")
        self.begin_op(ctx, op_id, "opPattern")
        refs = self.query(ctx, d.get("entities"))
        if not refs:
            raise FSError("opPattern: nothing selected to pattern")
        if any(r.kind != "BODY" for r in refs):
            raise SimulatorGap("opPattern of faces")
        transforms = untag(d.get("transforms") or ())
        names = untag(d.get("instanceNames") or ())
        if len(transforms) != len(names):
            raise FSError("opPattern: transforms and instanceNames must be the same size")
        if len(set(names)) != len(names) or any(not untag(n) for n in names):
            raise FSError("opPattern: instanceNames must be distinct non-empty strings")
        for transform, name in zip(transforms, names):
            trsf = self.conv.transform(transform)
            for ref in refs:
                moved = BRepBuilderAPI_Transform(ref.body.shape, trsf, True).Shape()
                body = ctx.add_body(Body(ref.body.kind, moved, op_id + (str(untag(name)),)))
                body.info = single_info(moved, body.created_by)
        return None

    def n_opTransform(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opTransform")
        self.begin_op(ctx, op_id, "opTransform")
        trsf = self.conv.transform(d.get("transform"))
        for body in self.bodies_from(ctx, d.get("bodies"), "opTransform", solid_only=False):
            builder = BRepBuilderAPI_Transform(body.shape, trsf, True)
            new_shape = builder.Shape()
            body.info = inherit_info(builder, [body], new_shape, op_id)
            body.shape = new_shape
        return None

    def n_opDeleteBodies(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opDeleteBodies")
        self.begin_op(ctx, op_id, "opDeleteBodies")
        for ref in self.query(ctx, d.get("entities")):
            ref.body.alive = False
        return None

    def n_opShell(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opShell")
        self.begin_op(ctx, op_id, "opShell")
        refs = self.query(ctx, d.get("entities"))
        if not refs:
            raise FSError("opShell: nothing selected")
        thickness = self.conv.length(d.get("thickness"), "thickness")
        if abs(thickness) < 1e-9:
            raise FSError("opShell: thickness is zero")
        by_body = {}
        for ref in refs:
            by_body.setdefault(ref.body.uid, (ref.body, []))[1].append(ref)
        for body, items in by_body.values():
            if body.kind != "SOLID":
                raise FSError("opShell: selection must be faces of a solid")
            faces = [r.shape for r in items if r.kind == "FACE"]
            if not faces:
                raise SimulatorGap("opShell hollowing a whole body without removing faces")
            box = bbox(body.shape)
            smallest = min(box[3] - box[0], box[4] - box[1], box[5] - box[2])
            if thickness < 0 and abs(thickness) >= smallest:
                raise FSError(f"opShell failed: wall thickness {abs(thickness) / 0.0254:.4g} in is not smaller than the part ({smallest / 0.0254:.4g} in)")
            maker = BRepOffsetAPI_MakeThickSolid()
            maker.MakeThickSolidByJoin(body.shape, list_of(faces), thickness, 1e-6)
            maker.Build()
            if not maker.IsDone():
                raise FSError("opShell failed (wall too thick for the part?)")
            shape = maker.Shape()
            original = volume(body.shape)
            result_volume = volume(shape)
            # OpenCascade often flags thin-wall shells as invalid even when the solid is
            # right (Parasolid has no such trouble), so judge the result by its volume.
            if len(solids_of(shape)) != 1 or result_volume <= 0 or (thickness < 0 and result_volume >= original):
                raise FSError("opShell produced invalid geometry (wall too thick for the part?)")
            info = inherit_info(maker, [body], shape, op_id)
            body.shape = solids_of(shape)[0] if solids_of(shape) else shape
            body.info = {SKey(s): info.get(SKey(s), EntInfo(op_id)) for kind in ("FACE", "EDGE", "VERTEX") for s in sub_shapes(body.shape, kind)}
        return None

    def edge_groups(self, ctx, query, what):
        refs = self.query(ctx, query)
        groups = {}
        for ref in refs:
            if ref.kind == "EDGE":
                groups.setdefault(ref.body.uid, (ref.body, []))[1].append(ref.shape)
            elif ref.kind == "FACE":
                groups.setdefault(ref.body.uid, (ref.body, [])); groups[ref.body.uid][1].extend(sub_shapes(ref.shape, "EDGE"))
        if not groups:
            raise FSError(f"{what}: no edges selected")
        return groups.values()

    def n_opFillet(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opFillet")
        self.begin_op(ctx, op_id, "opFillet")
        radius = self.conv.length(d.get("radius"), "radius")
        if radius <= 0:
            raise FSError("opFillet: radius must be positive")
        for body, edges in self.edge_groups(ctx, d.get("entities"), "opFillet"):
            maker = BRepFilletAPI_MakeFillet(body.shape)
            try:
                for edge in edges:
                    maker.Add(radius, edge)
                maker.Build()
            except Exception:
                pass
            if not safe_done(maker):
                raise FSError(f"opFillet failed: radius {radius * 1000:.3g} mm is too large for the selected edges")
            self.finish_modify(body, maker, op_id, "opFillet")
        return None

    def n_opChamfer(self, interp, args, node):
        ctx, op_id = self.ctx(args[0]), fs_id(args[1])
        d = arg_map(interp, args[2], "opChamfer")
        self.begin_op(ctx, op_id, "opChamfer")
        ctype = self.conv.enum(d.get("chamferType"), "EQUAL_OFFSETS")
        if ctype != "EQUAL_OFFSETS":
            raise SimulatorGap(f"opChamfer {ctype}")
        width = self.conv.length(d.get("width"), "width")
        if width <= 0:
            raise FSError("opChamfer: width must be positive")
        for body, edges in self.edge_groups(ctx, d.get("entities"), "opChamfer"):
            maker = BRepFilletAPI_MakeChamfer(body.shape)
            try:
                for edge in edges:
                    maker.Add(width, edge)
                maker.Build()
            except Exception:
                pass
            if not safe_done(maker):
                raise FSError(f"opChamfer failed: width {width * 1000:.3g} mm is too large for the selected edges")
            self.finish_modify(body, maker, op_id, "opChamfer")
        return None

    def finish_modify(self, body, maker, op_id, what):
        shape = maker.Shape()
        if not is_valid(shape) or volume(shape) <= 0:
            raise FSError(f"{what} produced invalid geometry")
        info = inherit_info(maker, [body], shape, op_id)
        solids = solids_of(shape)
        body.shape = solids[0] if len(solids) == 1 else shape
        body.info = {SKey(s): info.get(SKey(s), EntInfo(op_id)) for kind in ("FACE", "EDGE", "VERTEX") for s in sub_shapes(body.shape, kind)}


def unify_faces(shape, info, op_id):
    """Merge coplanar/co-cylindrical neighbours like Parasolid does after a boolean."""
    from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
    unify = ShapeUpgrade_UnifySameDomain(shape, True, True, False)
    unify.SetLinearTolerance(1e-7)
    unify.Build()
    merged = unify.Shape()
    history = unify.History()
    new_info = {}
    for key, ent in info.items():
        sub = key.shape
        modified = history.Modified(sub)
        if modified.Size() > 0:
            for m in modified:
                k = SKey(m)
                new_info[k] = new_info[k].merged(ent, op_id) if k in new_info else ent
        elif not history.IsRemoved(sub):
            new_info[key] = new_info[key].merged(ent) if key in new_info else ent
    for kind in ("FACE", "EDGE", "VERTEX"):
        for sub in sub_shapes(merged, kind):
            new_info.setdefault(SKey(sub), EntInfo(op_id))
    return merged, new_info


def safe_done(maker):
    try:
        return maker.IsDone()
    except Exception:
        return False


def face_normal(face):
    surface = BRepAdaptor_Surface(face)
    if surface.GetType() != GeomAbs_Plane:
        return None
    direction = surface.Plane().Axis().Direction()
    return np.array([direction.X(), direction.Y(), direction.Z()])


def check_axis_side(face, origin, direction):
    """Onshape refuses to revolve a region that crosses its axis."""
    n = face_normal(face)
    if n is None:
        return
    side = np.cross(direction, n)  # in-plane direction perpendicular to the axis
    if np.linalg.norm(side) < 1e-9:
        raise FSError("opRevolve: the axis is perpendicular to the region's plane")
    side = side / np.linalg.norm(side)
    BRepMesh_IncrementalMesh(face, 1e-4, False, 0.2, True)
    values = []
    for edge in sub_shapes(face, "EDGE"):
        curve = BRepAdaptor_Curve(edge)
        for i in range(9):
            t = curve.FirstParameter() + (curve.LastParameter() - curve.FirstParameter()) * i / 8
            p = curve.Value(t)
            values.append(float((np.array([p.X(), p.Y(), p.Z()]) - origin) @ side))
    if values and min(values) < -1e-7 and max(values) > 1e-7:
        raise FSError("opRevolve: the region crosses the revolve axis")


def connect_edges(edges):
    if len(edges) == 1:
        return BRepBuilderAPI_MakeWire(edges[0]).Wire()
    from OCP.collections import HSequence_TopoDS_Shape as TopTools_HSequenceOfShape
    seq = TopTools_HSequenceOfShape()
    for e in edges:
        seq.Append(e)
    wires = TopTools_HSequenceOfShape()
    ShapeAnalysis_FreeBounds.ConnectEdgesToWires_s(seq, 1e-6, False, wires)
    if wires.Length() != 1:
        raise FSError("opSweep: path edges do not form one connected chain")
    return TopoDS.Wire(wires.Value(1))


def fuse_all(shapes):
    fuse = BRepAlgoAPI_Fuse()
    fuse.SetArguments(list_of(shapes[:1]))
    fuse.SetTools(list_of(shapes[1:]))
    fuse.Build()
    return fuse.Shape()


GEOM_METHODS = [
    "reportFeatureStatus", "isContext", "isSketch", "newContext", "setVariable", "getVariable",
    "newSketch", "skLineSegment", "skCircle", "skArc", "skFitSpline", "skEllipse", "skPoint", "skSolve",
    "evaluateQuery", "evaluateQueryCount", "isQueryEmpty", "evEdgeCurvatures", "evPlane", "evOwnerSketchPlane", "evVolume", "evArea", "evLength", "evBox",
    "opExtrude", "opRevolve", "opLoft", "opSweep", "opBoolean", "opPattern", "opTransform", "opDeleteBodies", "opShell", "opFillet", "opChamfer",
]
NOOP_NATIVES = ["skConstraint", "setErrorEntities", "setHighlightedEntities", "setDimensionedEntities", "clearFeatureStatus",
                "setFeatureComputedParameter", "reportFeatureInfo", "setExternalDisambiguation", "skSetInitialGuess", "recordQuery"]
FALSE_NATIVES = ["isInFeaturePattern", "isInSheetMetalFeature"]


def install(interp):
    geom = Geom(interp)
    natives = {}
    for name in GEOM_METHODS:
        natives[name] = getattr(geom, "n_" + name)
    for name in NOOP_NATIVES:
        natives[name] = geom.n_noop
    for name in FALSE_NATIVES:
        natives[name] = geom.n_false
    natives["functionReportFeatureStatus"] = geom.n_reportFeatureStatus
    interp.natives.update(natives)
    interp.geom = geom
    return geom
