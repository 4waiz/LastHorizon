"""
LastHorizon — the five hidden keepsakes.

Exports `public/assets/models/collectibles.glb`:

    PaperPlane, ToyBoat, WindChime, OldCamera, StarOrnament

Each is roughly 0.3 m across and centred on its own origin so the runtime can
bob and spin it in place.
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, cylinder, mesh_from, bevel, rotate_verts,
    join_objects, export_glb, tri_count,
)


def paper_plane():
    v = [
        (0.00, 0.26, 0.00), (0.00, -0.20, 0.02),
        (-0.19, -0.14, -0.05), (0.19, -0.14, -0.05),
        (-0.05, -0.20, 0.05), (0.05, -0.20, 0.05),
    ]
    f = [(0, 2, 1), (0, 1, 3), (0, 1, 4), (0, 5, 1), (1, 2, 4), (1, 5, 3)]
    o = mesh_from("PaperPlane", v, f, "paper_white")
    return o


def toy_boat():
    o = []
    hull = [
        (-0.13, -0.20, 0.00), (0.13, -0.20, 0.00), (0.10, 0.18, 0.00), (-0.10, 0.18, 0.00),
        (-0.15, -0.24, 0.10), (0.15, -0.24, 0.10), (0.00, 0.30, 0.10),
    ]
    hf = [(3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 6), (3, 0, 4, 6), (4, 5, 6)]
    o.append(mesh_from("hull", hull, hf, "boat_red"))
    o.append(box("deck", (0.26, 0.44, 0.03), (0, 0.01, 0.10), "boat_wood"))
    o.append(cylinder("mast", 0.012, 0.34, 6, (0, 0.02, 0.11), "boat_wood"))
    sail = [(0.005, 0.02, 0.14), (0.005, 0.02, 0.43), (0.005, -0.19, 0.16)]
    o.append(mesh_from("sail", sail, [(0, 1, 2)], "paper_white"))
    return join_objects(o, "ToyBoat")


def wind_chime():
    o = [cylinder("top", 0.11, 0.025, 12, (0, 0, 0.22), "chime_wood")]
    for i in range(5):
        a = i * math.tau / 5
        x, y = math.cos(a) * 0.072, math.sin(a) * 0.072
        ln = 0.20 + 0.05 * (i % 3)
        o.append(cylinder("tb%d" % i, 0.016, ln, 6, (x, y, 0.20 - ln), "chime_metal"))
        o.append(box("st%d" % i, (0.004, 0.004, 0.03), (x, y, 0.205), "chime_wood"))
    o.append(cylinder("clap", 0.035, 0.012, 8, (0, 0, 0.02), "chime_wood"))
    o.append(box("cord", (0.004, 0.004, 0.20), (0, 0, 0.11), "chime_wood"))
    return join_objects(o, "WindChime")


def old_camera():
    o = []
    body = box("body", (0.30, 0.17, 0.19), (0, 0, 0.10), "camera_body")
    bevel(body, 0.022, 2)
    o.append(body)
    lens = cylinder("lens", 0.068, 0.10, 12, (0, -0.085, 0.10), "camera_metal")
    rotate_verts(lens, (math.pi / 2, 0, 0), (0, -0.085, 0.10))
    o.append(lens)
    ring = cylinder("ring", 0.078, 0.025, 12, (0, -0.125, 0.10), "camera_body")
    rotate_verts(ring, (math.pi / 2, 0, 0), (0, -0.125, 0.10))
    o.append(ring)
    o.append(box("vf", (0.055, 0.05, 0.035), (-0.095, 0, 0.205), "camera_metal"))
    o.append(cylinder("shut", 0.017, 0.022, 8, (0.085, -0.02, 0.195), "boat_red"))
    o.append(box("strap", (0.34, 0.02, 0.012), (0, 0.06, 0.20), "chime_wood"))
    return join_objects(o, "OldCamera")


def star_ornament():
    R, r = 0.20, 0.085
    rim = []
    for i in range(10):
        a = i * math.pi / 5 + math.pi / 2
        rad = R if i % 2 == 0 else r
        rim.append((math.cos(a) * rad, 0.0, math.sin(a) * rad))
    n = len(rim)
    verts = [(0.0, -0.045, 0.0), (0.0, 0.045, 0.0)] + rim
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((0, 2 + j, 2 + i))
        faces.append((1, 2 + i, 2 + j))
    o = [mesh_from("star", verts, faces, "star_gold"),
         cylinder("loop", 0.018, 0.012, 8, (0, 0, 0.215), "chime_metal")]
    obj = join_objects(o, "StarOrnament")
    for v in obj.data.vertices:
        v.co.z += 0.21
    return obj


def build():
    reset_scene()
    objs = [paper_plane(), toy_boat(), wind_chime(), old_camera(), star_ornament()]
    info = export_glb(objs, "collectibles.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
