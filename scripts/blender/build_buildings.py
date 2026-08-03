"""
LastHorizon — original Mediterranean building kit.

Exports `public/assets/models/buildings.glb` containing five root objects:

    HouseLarge   two-storey, overhanging upper floor on square columns
    HouseSmall   single storey with a red awning porch
    HouseSolar   low house under a big solar array roof
    PorchHouse   wide open canopy on slim columns
    Shed         plank walls, corrugated metal roof

Every object's origin sits on the ground at its footprint centre and faces
-Y in Blender (+Z in Three.js), so world placement is just position + yaw.
"""

import bpy
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, wedge, gable_roof, cylinder, rotate_verts,
    bevel, join_objects, export_glb, tri_count,
)


# --------------------------------------------------------------------------
# Shared building components
# --------------------------------------------------------------------------

def window(name, w, h, pos, facing="y", frame="window_frame",
           glass="window_glass", panes=3, depth=0.10):
    """Recessed window: frame slab, glass, and vertical mullions."""
    x, y, z = pos
    out = []
    if facing == "y":
        out.append(box(name + "_f", (w + 0.14, depth, h + 0.14), (x, y, z), frame))
        out.append(box(name + "_g", (w, depth * 0.5, h), (x, y - depth * 0.34, z), glass))
        for i in range(1, panes):
            mx = x - w / 2 + w * i / panes
            out.append(box(name + "_m%d" % i, (0.035, depth * 0.6, h),
                           (mx, y - depth * 0.40, z), frame))
        out.append(box(name + "_s", (w + 0.20, depth * 1.5, 0.06),
                       (x, y - depth * 0.20, z - h / 2 - 0.08), frame))
    else:
        out.append(box(name + "_f", (depth, w + 0.14, h + 0.14), (x, y, z), frame))
        out.append(box(name + "_g", (depth * 0.5, w, h), (x - depth * 0.34, y, z), glass))
        for i in range(1, panes):
            my = y - w / 2 + w * i / panes
            out.append(box(name + "_m%d" % i, (depth * 0.6, 0.035, h),
                           (x - depth * 0.40, my, z), frame))
        out.append(box(name + "_s", (depth * 1.5, w + 0.20, 0.06),
                       (x - depth * 0.20, y, z - h / 2 - 0.08), frame))
    return out


def louvre_vent(name, w, h, pos, facing="y", slats=4):
    """Small louvred wall vent — a recurring detail on the reference houses."""
    x, y, z = pos
    out = [box(name + "_f", (w, 0.07, h) if facing == "y" else (0.07, w, h),
               (x, y, z), "vent_grey")]
    for i in range(slats):
        sz = z - h / 2 + h * (i + 0.5) / slats
        size = (w * 0.8, 0.10, h / slats * 0.42) if facing == "y" else \
               (0.10, w * 0.8, h / slats * 0.42)
        px = (x, y - 0.015, sz) if facing == "y" else (x - 0.015, y, sz)
        out.append(box(name + "_s%d" % i, size, px, "concrete_dk"))
    return out


def door(name, w, h, pos, colour="door_navy", facing="y"):
    x, y, z = pos
    out = []
    if facing == "y":
        out.append(box(name + "_f", (w + 0.16, 0.12, h + 0.10), (x, y, z), "window_frame"))
        out.append(box(name + "_p", (w, 0.10, h), (x, y - 0.05, z), colour))
        out.append(box(name + "_h", (0.05, 0.10, 0.16),
                       (x + w * 0.34, y - 0.11, z), "metal_light"))
        out.append(box(name + "_step", (w + 0.44, 0.34, 0.10),
                       (x, y - 0.24, z - h / 2 + 0.05), "concrete"))
    else:
        out.append(box(name + "_f", (0.12, w + 0.16, h + 0.10), (x, y, z), "window_frame"))
        out.append(box(name + "_p", (0.10, w, h), (x - 0.05, y, z), colour))
    return out


def roof_with_fascia(name, w, d, h, z, overhang, ridge, top="roof_red"):
    """Pitched roof plus a slightly larger dark under-slab for eave thickness."""
    return [
        gable_roof(name + "_u", w, d, h * 1.03, (0, 0, z - 0.13),
                   overhang + 0.07, ridge, "roof_under"),
        gable_roof(name + "_t", w, d, h, (0, 0, z), overhang, ridge, top),
    ]


def solar_array(name, w, d, cols, rows, pos, tilt, mat="solar_panel"):
    """Dark panel bed plus a lattice of light frame strips, tilted about X.

    tilt > 0 raises the +Y edge, so the array faces the road at -Y.
    """
    x, y, z = pos
    out = [box(name + "_p", (w, d, 0.07), (x, y, z), mat)]
    for i in range(cols + 1):
        px = x - w / 2 + w * i / cols
        out.append(box(name + "_v%d" % i, (0.05, d, 0.09), (px, y, z + 0.01), "solar_frame"))
    for j in range(rows + 1):
        py = y - d / 2 + d * j / rows
        out.append(box(name + "_h%d" % j, (w, 0.05, 0.09), (x, py, z + 0.01), "solar_frame"))
    for o in out:
        rotate_verts(o, (tilt, 0, 0), pos)
    return out


def corrugated(name, w, d, pos, mat="metal_light", ribs=14):
    x, y, z = pos
    out = [box(name + "_b", (w, d, 0.05), (x, y, z), mat)]
    for i in range(ribs):
        px = x - w / 2 + w * (i + 0.5) / ribs
        out.append(box(name + "_r%d" % i, (w / ribs * 0.42, d, 0.10), (x + (px - x), y, z + 0.03),
                       mat))
    return out


# --------------------------------------------------------------------------
# HouseLarge — the hero building from the reference frames
# --------------------------------------------------------------------------

def house_large():
    W, D = 8.0, 6.4
    GF, UF = 2.55, 2.85          # ground / upper floor heights
    o = []

    # plinth + ground floor set back behind the columns
    o.append(box("plinth", (W - 0.5, D - 0.4, 0.30), (0, 0, 0.15), "concrete_dk"))
    o.append(box("gf", (W - 1.5, D - 1.5, GF), (0, 0.45, 0.30 + GF / 2), "wall_grey"))

    # square columns carrying the overhanging upper floor
    for cx in (-3.35, -1.65, 0.6, 2.9):
        c = box("col%d" % int(cx * 10), (0.34, 0.34, GF + 0.30), (cx, -2.55, (GF + 0.30) / 2),
                "wall_mauve")
        bevel(c, 0.02, 1)
        o.append(c)
        o.append(box("colcap%d" % int(cx * 10), (0.46, 0.46, 0.12), (cx, -2.55, GF + 0.36),
                     "concrete"))
    o.append(box("beam", (W - 0.4, 0.42, 0.34), (0, -2.55, GF + 0.47), "wall_mauve"))

    # upper floor slab + walls
    zf = GF + 0.30
    o.append(box("slab", (W, D, 0.26), (0, 0, zf + 0.13), "concrete"))
    o.append(box("uf", (W, D, UF), (0, 0, zf + 0.26 + UF / 2), "wall_pink"))
    zt = zf + 0.26 + UF

    # skirting band that separates the two colours
    o.append(box("band", (W + 0.06, D + 0.06, 0.14), (0, 0, zf + 0.33), "wall_mauve"))

    # roof
    o += roof_with_fascia("roof", W, D, 2.45, zt, 0.62, "y", "roof_red")

    # dormer with planter box, as in the reference
    o.append(box("dorm", (2.15, 1.25, 1.05), (0.55, -1.9, zt + 0.72), "wall_pink"))
    o += roof_with_fascia("dormroof", 2.45, 1.5, 0.62, zt + 1.24, 0.10, "x", "roof_red")
    o += window("dormwin", 1.55, 0.72, (0.55, -2.49, zt + 0.80), "y", panes=2)
    o.append(box("planter", (2.05, 0.30, 0.26), (0.55, -2.66, zt + 0.36), "wood_light"))
    for i in range(5):
        o.append(box("plant%d" % i, (0.24, 0.22, 0.24),
                     (-0.28 + i * 0.42, -2.66, zt + 0.58), "leaf_mid"))

    # upper floor windows
    o += window("uw1", 2.05, 1.05, (-2.25, -D / 2, zf + 1.75), "y", panes=3)
    o += window("uw2", 1.15, 0.95, (0.95, -D / 2, zf + 1.70), "y", panes=2)
    o += window("uw3", 1.75, 1.00, (-W / 2, -1.0, zf + 1.75), "x", panes=3)
    o += window("uw4", 1.45, 0.95, (W / 2, 0.8, zf + 1.72), "x", panes=2)
    o += louvre_vent("uv1", 0.44, 0.78, (-0.55, -D / 2 - 0.01, zf + 1.68))
    o += louvre_vent("uv2", 0.40, 0.70, (2.65, -D / 2 - 0.01, zf + 1.60))

    # ground floor openings behind the columns
    o += window("gw1", 1.75, 0.95, (-1.9, -D / 2 + 0.75, 1.62), "y", panes=3)
    o += door("gd", 0.95, 2.05, (1.35, -D / 2 + 0.75, 1.32), "door_wood")
    o += louvre_vent("gv1", 0.42, 0.62, (0.15, -D / 2 + 0.74, 1.70))

    return join_objects(o, "HouseLarge")


# --------------------------------------------------------------------------
# HouseSmall — cream walls, orange roof, red awning
# --------------------------------------------------------------------------

def house_small():
    W, D, H = 6.2, 5.0, 2.95
    o = []
    o.append(box("plinth", (W + 0.3, D + 0.3, 0.26), (0, 0, 0.13), "concrete_dk"))
    o.append(box("body", (W, D, H), (0, 0, 0.26 + H / 2), "wall_cream"))
    o.append(box("base", (W + 0.08, D + 0.08, 0.55), (0, 0, 0.26 + 0.27), "wall_sand"))
    zt = 0.26 + H
    o += roof_with_fascia("roof", W, D, 1.95, zt, 0.55, "y", "roof_orange")

    # chimney
    o.append(box("chim", (0.52, 0.52, 1.35), (1.85, 1.05, zt + 0.90), "wall_sand"))
    o.append(box("chimcap", (0.70, 0.70, 0.12), (1.85, 1.05, zt + 1.62), "roof_dark"))

    # awning porch over the entrance
    o.append(wedge("awn", (3.3, 1.35, 0.55), (-0.55, -D / 2 - 0.60, 2.42), "roof_orange", "y"))
    o.append(box("awnlip", (3.4, 0.12, 0.16), (-0.55, -D / 2 - 1.26, 2.20), "roof_dark"))
    for cx in (-2.05, 0.95):
        o.append(cylinder("apost%d" % int(cx * 10), 0.065, 2.35, 8,
                          (cx, -D / 2 - 1.18, 0.05), "metal_grey"))

    o += door("d", 1.00, 2.10, (-0.55, -D / 2, 1.40), "door_navy")
    o += window("w1", 1.85, 1.00, (1.85, -D / 2, 1.85), "y", panes=3)
    o += window("w2", 1.55, 0.95, (-W / 2, 0.6, 1.85), "x", panes=3)
    o += window("w3", 1.25, 0.90, (W / 2, -0.7, 1.82), "x", panes=2)
    o += louvre_vent("v1", 0.40, 0.60, (-2.35, -D / 2 - 0.01, 2.10))
    return join_objects(o, "HouseSmall")


# --------------------------------------------------------------------------
# HouseSolar — low house under a large tilted solar roof
# --------------------------------------------------------------------------

def house_solar():
    W, D, H = 7.0, 5.6, 2.70
    TILT = 0.30                     # radians; +Y edge lifted, array faces the road
    o = []
    o.append(box("plinth", (W + 0.3, D + 0.3, 0.24), (0, 0, 0.12), "concrete_dk"))
    o.append(box("body", (W, D, H), (0, 0, 0.24 + H / 2), "wall_mauve"))
    o.append(box("band", (W + 0.08, D + 0.08, 0.48), (0, 0, 0.48), "wall_grey"))
    zt = 0.24 + H

    # mono-pitch deck: a slab tilted about its own centre, plus the array
    pivot = (0, 0.10, zt + 0.42)
    deck = box("deck", (W + 0.9, D + 1.1, 0.26), pivot, "roof_under")
    rotate_verts(deck, (TILT, 0, 0), pivot)
    o.append(deck)
    gable = box("gend", (W + 0.9, 0.20, 1.30), (0, D / 2 + 0.45, zt + 0.72), "wall_grey")
    o.append(gable)
    o += solar_array("sa", W + 0.55, D + 0.55, 6, 4, (0, 0.10, zt + 0.58), TILT)

    o += window("w1", 2.0, 1.05, (-1.9, -D / 2, 1.80), "y", panes=3)
    o += window("w2", 1.4, 0.95, (1.9, -D / 2, 1.78), "y", panes=2)
    o += door("d", 0.95, 2.05, (0.15, -D / 2, 1.32), "door_wood")
    o += window("w3", 1.6, 0.95, (-W / 2, 0.9, 1.80), "x", panes=3)
    o += louvre_vent("v1", 0.44, 0.66, (-3.2, -D / 2 - 0.01, 1.95))
    o.append(box("meter", (0.36, 0.16, 0.50), (2.9, -D / 2 - 0.06, 1.35), "vent_grey"))
    return join_objects(o, "HouseSolar")


# --------------------------------------------------------------------------
# PorchHouse — the wide open canopy from the third reference frame
# --------------------------------------------------------------------------

def porch_house():
    W, D, H = 7.6, 4.6, 3.05
    o = []
    o.append(box("body", (W - 1.2, D, H), (0, 1.5, H / 2), "wall_mauve"))
    o.append(box("plinth", (W - 1.0, D + 0.2, 0.18), (0, 1.5, 0.09), "concrete_dk"))

    # canopy: dark underside + light top, big overhang
    o.append(box("ceil", (W, 5.0, 0.16), (0, -0.6, H + 0.02), "roof_under"))
    o += roof_with_fascia("croof", W + 0.5, 5.4, 0.85, H + 0.10, 0.24, "y", "roof_orange")

    # slim columns: two painted timber, two galvanised
    for cx, mat in ((-3.1, "metal_grey"), (-1.05, "grass_dry"),
                    (1.05, "grass_dry"), (3.1, "metal_grey")):
        o.append(box("post%d" % int(cx * 10), (0.14, 0.14, H), (cx, -2.55, H / 2), mat))
        o.append(box("foot%d" % int(cx * 10), (0.24, 0.24, 0.10), (cx, -2.55, 0.05), "concrete"))

    o += door("d", 1.05, 2.20, (0.55, -0.72, 1.20), "door_navy")
    o += window("w1", 1.30, 1.05, (-1.85, -0.72, 1.70), "y", panes=1)
    o += window("w2", 1.45, 0.95, (-(W - 1.2) / 2, 1.9, 1.80), "x", panes=2)
    return join_objects(o, "PorchHouse")


# --------------------------------------------------------------------------
# Shed — plank walls, corrugated roof
# --------------------------------------------------------------------------

def shed():
    W, D, H = 4.4, 3.2, 2.35
    o = []
    o.append(box("body", (W, D, H), (0, 0, H / 2), "wood_plank"))
    for i in range(9):
        px = -W / 2 + W * (i + 0.5) / 9
        o.append(box("pl%d" % i, (W / 9 * 0.16, D + 0.05, H), (px, 0, H / 2), "wood_pole"))
    o.append(wedge("roof", (W + 0.7, D + 0.7, 0.75), (0, 0, H + 0.375), "metal_grey", "y"))
    o += corrugated("cor", W + 0.7, 0.12, (0, -D / 2 - 0.32, H + 0.06), "metal_light", 12)
    o += door("d", 1.10, 1.95, (0, -D / 2, 0.98), "wood_light")
    return join_objects(o, "Shed")


# --------------------------------------------------------------------------

def build():
    reset_scene()
    objs = [house_large(), house_small(), house_solar(), porch_house(), shed()]
    info = export_glb(objs, "buildings.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
