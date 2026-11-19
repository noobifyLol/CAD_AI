"""Batch test, step 3: one picture with an iso view of every part in a folder.
Usage: .fsgen/venv/Scripts/python scripts/eval/contact_sheet.py <dir> <prefix> <out.png>
"""
import pathlib
import sys

folder, prefix, out = sys.argv[1:4]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.argv = [sys.argv[0]]
import local_build  # noqa: E402,F401  (applies the FS-Lite patches)
from fsgen.fslite.runner import run_source  # noqa: E402
from fsgen.fslite import geom as G  # noqa: E402

import matplotlib  # noqa: E402
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402
import numpy as np  # noqa: E402
from OCP.BRepMesh import BRepMesh_IncrementalMesh  # noqa: E402
from OCP.TopLoc import TopLoc_Location  # noqa: E402

files = sorted(pathlib.Path(folder).glob(prefix + "*.fs"))
cols = 5
rows = max(1, (len(files) + cols - 1) // cols)
fig = plt.figure(figsize=(cols * 3.2, rows * 3.2))
for k, path in enumerate(files):
    ax = fig.add_subplot(rows, cols, k + 1, projection="3d")
    label = path.stem[len(prefix):][:28]
    res = None
    try:
        res = run_source(path.read_text(encoding="utf-8"))
        solids = res.solids if res.ok else []
    except Exception:
        solids = []
    tris = []
    for body in solids:
        BRepMesh_IncrementalMesh(body.shape, 0.02, True, 0.5, True)  # relative: big curved parts mesh fast
        for face in G.subshapes(body.shape, G.TopAbs_FACE):
            loc = TopLoc_Location()
            tri = G.BRep_Tool.Triangulation_s(G.TopoDS.Face(face), loc)
            if tri is None:
                continue
            trsf = loc.Transformation()
            pts = np.array([[p.X(), p.Y(), p.Z()] for p in (tri.Node(i).Transformed(trsf) for i in range(1, tri.NbNodes() + 1))]) * 1000
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                tris.append(pts[[a - 1, b - 1, c - 1]])
    if tris:
        tris = np.array(tris)
        lo, hi = tris.reshape(-1, 3).min(0), tris.reshape(-1, 3).max(0)
        ctr, span = (lo + hi) / 2, (hi - lo).max() / 2 * 1.05
        n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        light = np.array([0.4, -0.6, 0.7])
        light /= np.linalg.norm(light)
        shade = 0.35 + 0.65 * np.abs(n @ light)
        ax.add_collection3d(Poly3DCollection(tris, facecolors=np.stack([shade * .55, shade * .68, shade * .85, np.ones_like(shade)], 1), edgecolor="none"))
        for i, axis in enumerate("xyz"):
            getattr(ax, f"set_{axis}lim")(ctr[i] - span, ctr[i] + span)
        ax.set_box_aspect((1, 1, 1))
        ax.set_title(f"{label}\n{len(solids)} body, {'x'.join(str(round(v)) for v in (hi - lo))} mm", fontsize=8)
    else:
        err = (res.error if res else "engine error") or "no solid"
        ax.set_title(f"{label}\nFAIL: {str(err)[:40]}", fontsize=8, color="red")
    ax.view_init(elev=25, azim=-55)
    ax.set_axis_off()
fig.tight_layout()
fig.savefig(out, dpi=70)
print(f"wrote {out}")
