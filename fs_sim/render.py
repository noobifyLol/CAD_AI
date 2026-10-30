"""Render simulated parts to PNG (shaded isometric view) and export STL."""
import numpy as np
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.StlAPI import StlAPI_Writer
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location

from .geom import bbox, make_compound, sub_shapes


def triangles(shapes, deflection=None):
    tris = []
    for shape in shapes:
        box = bbox(shape)
        size = max(box[3] - box[0], box[4] - box[1], box[5] - box[2]) if box else 1.0
        BRepMesh_IncrementalMesh(shape, deflection or size / 300.0, False, 0.25, True)
        for face in sub_shapes(shape, "FACE"):
            location = TopLoc_Location()
            mesh = BRep_Tool.Triangulation_s(face, location)
            if mesh is None:
                continue
            trsf = location.Transformation()
            reversed_face = face.Orientation() == TopAbs_REVERSED
            nodes = []
            for i in range(1, mesh.NbNodes() + 1):
                p = mesh.Node(i).Transformed(trsf)
                nodes.append((p.X(), p.Y(), p.Z()))
            nodes = np.array(nodes)
            for i in range(1, mesh.NbTriangles() + 1):
                a, b, c = mesh.Triangle(i).Get()
                tri = nodes[[a - 1, b - 1, c - 1]] if not reversed_face else nodes[[a - 1, c - 1, b - 1]]
                tris.append(tri)
    return np.array(tris) if tris else np.zeros((0, 3, 3))


def _draw(ax, tris, azim, elev=24):
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.where(lengths == 0, 1, lengths)
    # Back-face culling: matplotlib sorts polygons poorly, so drop the hidden side.
    e, a = np.radians(elev), np.radians(azim)
    eye = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    visible = normals @ eye > -1e-9
    shown, normals = tris[visible], normals[visible]
    light = eye * 0.6 + np.array([0.0, 0.0, 0.8])
    light = light / np.linalg.norm(light)
    shade = 0.3 + 0.7 * np.clip(normals @ light, 0, 1)
    base = np.array([0.30, 0.52, 0.80])
    colors = np.clip(base[None, :] * shade[:, None] + 0.08, 0, 1)
    ax.add_collection3d(Poly3DCollection(shown, facecolors=colors, edgecolors="none", linewidths=0))
    lo, hi = tris.reshape(-1, 3).min(axis=0), tris.reshape(-1, 3).max(axis=0)
    center, radius = (lo + hi) / 2, max(hi - lo) / 2 * 1.05
    ax.set_xlim(center[0] - radius, center[0] + radius)
    ax.set_ylim(center[1] - radius, center[1] + radius)
    ax.set_zlim(center[2] - radius, center[2] + radius)
    ax.view_init(elev=elev, azim=azim)
    ax.set_box_aspect((1, 1, 1))
    ax.set_axis_off()
    return hi - lo


def render_png(shapes, path, title="", size=(900, 460)):
    """Two opposite isometric views side by side (front-right and back-left)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    tris = triangles(shapes) / 0.0254  # inches
    fig = plt.figure(figsize=(size[0] / 100, size[1] / 100), dpi=100)
    if len(tris):
        dims = None
        for index, azim in enumerate((-58, 122)):
            ax = fig.add_subplot(1, 2, index + 1, projection="3d")
            dims = _draw(ax, tris, azim)
        fig.suptitle(f"{title}  —  {dims[0]:.3g} × {dims[1]:.3g} × {dims[2]:.3g} in", fontsize=10)
    else:
        fig.suptitle(f"{title}  (no geometry)", fontsize=10)
    fig.subplots_adjust(left=0, right=1, bottom=0, top=0.92, wspace=0)
    fig.savefig(path)
    plt.close(fig)


def write_stl(shapes, path):
    compound = make_compound(shapes)
    BRepMesh_IncrementalMesh(compound, 1e-4, False, 0.25, True)
    StlAPI_Writer().Write(compound, path)
