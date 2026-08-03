"""
LastHorizon — street furniture and hard-surface props.

Exports `public/assets/models/props.glb`:

    Streetlight   tall pole, two swan-neck arms, downlight heads
    UtilityPole   timber pole, crossarm, insulators
    Barrier       painted timber road-closed barrier
    Bench         slatted timber bench
    Mailbox       post box on a stem
    FenceSection  vertical plank fence, 4 m module
    RetainWall    concrete retaining wall, 6 m module
    Culvert       drainage mouth set into an embankment
    Bollard       small reflective roadside post

Origins sit on the ground; assets face -Y in Blender (+Z in Three.js).
The lamp heads are kept as their own material so the runtime can swap in an
emissive version after dusk.
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, cylinder, tube_along, bevel, rotate_verts,
    join_objects, export_glb, tri_count,
)


def swan_arm(name, base_z, reach, rise, side, verts=7):
    """Quadratic-bezier lamp arm sweeping up and out from the pole."""
    pts = []
    p0 = (0.0, 0.0, base_z)
    p1 = (side * reach * 0.12, 0.0, base_z + rise * 1.15)
    p2 = (side * reach, 0.0, base_z + rise)
    for i in range(verts + 1):
        t = i / verts
        u = 1 - t
        pts.append(tuple(u * u * p0[k] + 2 * u * t * p1[k] + t * t * p2[k] for k in range(3)))
    return tube_along(name, pts, 0.058, 6, "pole_dark",
                      taper=lambda t: 1.0 - 0.32 * t), pts[-1]


def streetlight():
    H = 8.4
    o = []
    o.append(cylinder("base", 0.20, 0.55, 10, (0, 0, 0), "concrete_dk"))
    o.append(cylinder("pole", 0.115, H, 10, (0, 0, 0.40), "pole_dark", radius_top=0.075))

    for side, hz, reach in ((1, 0.0, 2.45), (-1, -0.55, 1.85)):
        arm, tip = swan_arm("arm%d" % side, H - 1.5 + hz, reach, 1.5, side)
        o.append(arm)
        head = box("head%d" % side, (0.62, 0.30, 0.13),
                   (tip[0] + side * 0.24, 0, tip[2] - 0.05), "lamp_head")
        bevel(head, 0.04, 2)
        o.append(head)
        lens = box("lens%d" % side, (0.46, 0.22, 0.05),
                   (tip[0] + side * 0.24, 0, tip[2] - 0.13), "lamp_glass")
        o.append(lens)
    return join_objects(o, "Streetlight")


def utility_pole():
    H = 9.2
    o = [cylinder("pole", 0.135, H, 8, (0, 0, 0), "wood_pole", radius_top=0.095)]
    for zc, half in ((H - 0.85, 1.05), (H - 1.85, 0.80)):
        o.append(box("arm%d" % int(zc * 10), (0.16, half * 2, 0.14), (0, 0, zc), "wood_pole"))
        for k in (-1, 0, 1):
            o.append(cylinder("ins%d_%d" % (int(zc * 10), k), 0.055, 0.16, 6,
                              (0, k * half * 0.86, zc + 0.07), "lamp_glass"))
    o.append(box("brace", (0.10, 0.10, 1.05), (0, 0.45, H - 1.35), "wood_pole"))
    o.append(box("boxg", (0.34, 0.24, 0.52), (0, -0.18, 2.30), "vent_grey"))
    return join_objects(o, "UtilityPole")


def barrier():
    o = []
    for sx in (-1.35, 1.35):
        o.append(box("leg%d" % int(sx * 10), (0.16, 0.16, 1.15), (sx, 0, 0.575), "wood_pole"))
        o.append(box("foot%d" % int(sx * 10), (0.34, 0.62, 0.12), (sx, 0, 0.06), "wood_pole"))
    for z in (0.62, 0.98):
        o.append(box("rail%d" % int(z * 100), (3.15, 0.11, 0.26), (0, 0, z), "barrier_wood"))
    for i, sx in enumerate((-0.95, -0.30, 0.35, 1.00)):
        o.append(box("stripe%d" % i, (0.26, 0.13, 0.26), (sx, 0, 0.98), "trim_white"))
    return join_objects(o, "Barrier")


def bench():
    o = []
    for sx in (-0.72, 0.72):
        o.append(box("leg%d" % int(sx * 10), (0.09, 0.52, 0.44), (sx, 0.02, 0.22), "metal_grey"))
        o.append(box("bk%d" % int(sx * 10), (0.08, 0.10, 0.58), (sx, 0.24, 0.66), "metal_grey"))
    for i in range(4):
        o.append(box("seat%d" % i, (1.72, 0.11, 0.055), (0, -0.20 + i * 0.135, 0.45),
                     "wood_light"))
    for i in range(3):
        o.append(box("back%d" % i, (1.72, 0.055, 0.11), (0, 0.28, 0.62 + i * 0.15),
                     "wood_light"))
    return join_objects(o, "Bench")


def mailbox():
    o = [box("post", (0.09, 0.09, 1.02), (0, 0, 0.51), "wood_pole")]
    body = box("body", (0.30, 0.46, 0.30), (0, 0, 1.17), "boat_red")
    bevel(body, 0.05, 2)
    o.append(body)
    o.append(box("flag", (0.035, 0.06, 0.22), (0.17, 0.10, 1.34), "trim_white"))
    o.append(box("slot", (0.20, 0.03, 0.035), (0, -0.23, 1.20), "pole_dark"))
    return join_objects(o, "Mailbox")


def fence_section():
    W, H = 4.0, 1.55
    o = [box("rail_b", (W, 0.06, 0.11), (0, 0, 0.42), "wood_pole"),
         box("rail_t", (W, 0.06, 0.11), (0, 0, 1.24), "wood_pole")]
    n = 21
    for i in range(n):
        px = -W / 2 + W * (i + 0.5) / n
        h = H - (0.03 if i % 3 else 0.0)
        o.append(box("pl%d" % i, (W / n * 0.86, 0.045, h), (px, -0.05, h / 2), "wood_plank"))
    for sx in (-W / 2 + 0.08, 0.0, W / 2 - 0.08):
        o.append(box("post%d" % int(sx * 10), (0.12, 0.12, H + 0.16), (sx, 0, (H + 0.16) / 2),
                     "wood_pole"))
    return join_objects(o, "FenceSection")


def retain_wall():
    W, H, D = 6.0, 2.35, 0.55
    o = [box("body", (W, D, H), (0, 0, H / 2), "concrete"),
         box("cap", (W + 0.12, D + 0.14, 0.16), (0, 0, H + 0.05), "concrete_dk")]
    for i in range(1, 4):
        o.append(box("j%d" % i, (0.05, D + 0.02, H), (-W / 2 + W * i / 4, 0, H / 2),
                     "concrete_dk"))
    o.append(box("stain", (W, 0.02, 0.5), (0, -D / 2 - 0.01, 0.28), "concrete_dk"))
    return join_objects(o, "RetainWall")


def culvert():
    o = [box("face", (1.9, 0.35, 1.35), (0, 0, 0.675), "concrete")]
    mouth = cylinder("mouth", 0.44, 0.42, 10, (0, 0.30, 0.52), "concrete_dk")
    rotate_verts(mouth, (math.pi / 2, 0, 0), (0, 0.30, 0.52))
    o.append(mouth)
    o.append(box("apron", (1.5, 0.9, 0.09), (0, -0.60, 0.045), "concrete_dk"))
    for i in range(4):
        o.append(box("bar%d" % i, (0.05, 0.05, 0.72), (-0.27 + i * 0.18, -0.20, 0.40),
                     "pole_dark"))
    return join_objects(o, "Culvert")


def bollard():
    o = [cylinder("p", 0.075, 0.95, 8, (0, 0, 0), "trim_white", radius_top=0.065),
         cylinder("t", 0.078, 0.14, 8, (0, 0, 0.66), "boat_red"),
         cylinder("c", 0.070, 0.04, 8, (0, 0, 0.95), "pole_dark")]
    return join_objects(o, "Bollard")


def build():
    reset_scene()
    objs = [streetlight(), utility_pole(), barrier(), bench(), mailbox(),
            fence_section(), retain_wall(), culvert(), bollard()]
    info = export_glb(objs, "props.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
