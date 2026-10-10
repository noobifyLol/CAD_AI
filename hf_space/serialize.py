"""Convert a Text2CAD/CadSeqProc CADSequence into the "cad-sequence/v1" JSON that
the CAD_AI Node app compiles into FeatureScript (see ../deepcadCompiler.js).

Geometry is copied exactly as CadSeqProc would build it:
  3D point = origin + u * x_axis + v * y_axis      (CoordinateSystem.rotate_vec)
  extent_one along +z_axis, extent_two along -z_axis (SketchSequence.extrudeBasedOnType)
"""
OPERATIONS = ["new", "join", "cut", "intersect"]


def _vec(values, size):
    return [float(values[i]) for i in range(size)]


def curve_to_v1(curve):
    kind = getattr(curve, "curve_type", type(curve).__name__).lower()
    meta = curve.metadata
    if kind == "line":
        return {"type": "line", "start": _vec(meta["start_point"], 2), "end": _vec(meta["end_point"], 2)}
    if kind == "arc":
        return {
            "type": "arc",
            "start": _vec(meta["start_point"], 2),
            "mid": _vec(meta["mid_point"], 2),
            "end": _vec(meta["end_point"], 2),
        }
    if kind == "circle":
        return {"type": "circle", "center": _vec(meta["center"], 2), "radius": float(meta["radius"])}
    raise ValueError(f"Unsupported curve type {kind!r}")


def extrude_interval(extent_one, extent_two):
    """(towardsNormal, oppositeNormal) covering exactly what extrudeBasedOnType builds."""
    if extent_one == 0:
        low, high = min(0.0, -extent_two), max(0.0, -extent_two)
    else:
        low, high = min(0.0, extent_one), max(0.0, extent_one)
        if extent_two > 0:
            low = min(low, -extent_two)
    return high, -low


def cad_sequence_to_v1(cad_seq, units="normalized"):
    steps = []
    dropped = []
    for index, (sketch, extrude) in enumerate(zip(cad_seq.sketch_seq, cad_seq.extrude_seq)):
        towards, opposite = extrude_interval(float(extrude.metadata["extent_one"]), float(extrude.metadata["extent_two"]))
        operation = OPERATIONS[int(extrude.metadata["boolean"])]
        if towards + opposite <= 1e-9:
            dropped.append(f"step {index + 1}: zero depth")
            continue
        if not steps and operation in ("cut", "intersect"):
            # CadSeqProc's create_cad_model has no solid to cut yet; skip like it does.
            dropped.append(f"step {index + 1}: {operation} before any body")
            continue
        frame = extrude.coordsystem.metadata
        faces = []
        for face in sketch.facedata:
            loops = [[curve_to_v1(curve) for curve in loop.curvedata] for loop in face.loopdata]
            loops = [loop for loop in loops if loop]
            if loops:
                faces.append({"loops": loops})
        if not faces:
            dropped.append(f"step {index + 1}: empty sketch")
            continue
        steps.append({
            "plane": {
                "origin": _vec(frame["origin"], 3),
                "xAxis": _vec(frame["x_axis"], 3),
                "normal": _vec(frame["z_axis"], 3),
            },
            "faces": faces,
            "extrude": {"towardsNormal": towards, "oppositeNormal": opposite, "operation": operation},
        })
    return {"format": "cad-sequence/v1", "source": "text2cad", "units": units, "steps": steps, "dropped": dropped}
