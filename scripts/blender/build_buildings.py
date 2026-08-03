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
    reset_scene, box, wedge, gable_roof, cylinder, rotate_verts, boolean_diff,
    ico_blob, bevel, join_objects, export_glb, tri_count,
)

import math  # noqa: E402


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

# --------------------------------------------------------------------------
# HouseOpen — the one you can actually walk into
# --------------------------------------------------------------------------
# Interior floor sits at the object origin (z = 0), so the runtime can seat it
# on a flattened terrain pad and the player walks straight in off the ground.

OPEN_W, OPEN_D, OPEN_H = 7.4, 6.2, 2.92
OPEN_T = 0.22                       # wall thickness
DOOR_W, DOOR_H = 1.20, 2.25
DOOR_CX = -1.35                     # doorway centre along local X


def _cutter(name, size, centre):
    return box(name, size, centre)


def house_open():
    W, D, H, T = OPEN_W, OPEN_D, OPEN_H, OPEN_T
    hw, hd = W / 2, D / 2
    o = []

    # ---- ground: plinth apron plus the interior floor deck ----------------
    o.append(box("apron", (W + 0.55, D + 0.55, 0.40), (0, 0, -0.20), "concrete_dk"))
    o.append(box("floor", (W - T * 2, D - T * 2, 0.10), (0, 0, -0.05), "wood_plank"))
    for i in range(11):
        px = -(W - T * 2) / 2 + (W - T * 2) * (i + 0.5) / 11
        o.append(box("plank%d" % i, ((W - T * 2) / 11 * 0.10, D - T * 2, 0.11),
                     (px, 0, -0.045), "wood_pole"))

    # ---- shell -----------------------------------------------------------
    back = box("wback", (W, T, H), (0, hd - T / 2, H / 2), "wall_cream")
    boolean_diff(back, [_cutter("cb", (1.55, 1.0, 1.05), (1.5, hd - T / 2, 1.62))])
    o.append(back)

    left = box("wleft", (T, D, H), (-hw + T / 2, 0, H / 2), "wall_cream")
    boolean_diff(left, [_cutter("cl", (1.0, 1.65, 1.10), (-hw + T / 2, -0.9, 1.66))])
    o.append(left)

    right = box("wright", (T, D, H), (hw - T / 2, 0, H / 2), "wall_cream")
    boolean_diff(right, [_cutter("cr", (1.0, 1.70, 1.10), (hw - T / 2, 0.7, 1.66))])
    o.append(right)

    # front wall in three pieces so the doorway is a real hole
    dl = DOOR_CX - DOOR_W / 2
    dr = DOOR_CX + DOOR_W / 2
    o.append(box("wf_l", (dl + hw, T, H), ((-hw + dl) / 2, -hd + T / 2, H / 2), "wall_cream"))
    o.append(box("wf_r", (hw - dr, T, H), ((dr + hw) / 2, -hd + T / 2, H / 2), "wall_cream"))
    o.append(box("wf_top", (DOOR_W, T, H - DOOR_H),
                 (DOOR_CX, -hd + T / 2, (H + DOOR_H) / 2), "wall_cream"))

    # exterior colour band and door surround
    o.append(box("skirt", (W + 0.06, D + 0.06, 0.55), (0, 0, 0.275), "wall_sand"))
    for sx in (dl - 0.06, dr + 0.06):
        o.append(box("djamb%d" % int(sx * 100), (0.13, T + 0.10, DOOR_H + 0.14),
                     (sx, -hd + T / 2, (DOOR_H + 0.14) / 2), "window_frame"))
    o.append(box("dhead", (DOOR_W + 0.32, T + 0.10, 0.14),
                 (DOOR_CX, -hd + T / 2, DOOR_H + 0.07), "window_frame"))
    o.append(box("dstep", (DOOR_W + 0.7, 0.5, 0.10), (DOOR_CX, -hd - 0.24, -0.05), "concrete"))

    # the door itself, standing open against the inside wall
    leaf = box("leaf", (DOOR_W - 0.05, 0.07, DOOR_H - 0.06),
               (0, 0, (DOOR_H - 0.06) / 2), "door_navy")
    rotate_verts(leaf, (0, 0, math.radians(78)), (-(DOOR_W - 0.05) / 2, 0, 0))
    for v in leaf.data.vertices:
        v.co.x += dl + 0.03
        v.co.y += -hd + T / 2
    o.append(leaf)

    # window frames, inside and out
    for cx, cy, cz, sw, sd in (
        (1.5, hd - T / 2, 1.62, 1.75, T + 0.12),
        (-hw + T / 2, -0.9, 1.66, 1.85, T + 0.12),
        (hw - T / 2, 0.7, 1.66, 1.90, T + 0.12),
    ):
        vertical = abs(abs(cx) - (hw - T / 2)) < 1e-6
        size = (sd, sw, 1.24) if vertical else (sw, sd, 1.22)
        o.append(box("wfrm%d_%d" % (int(cx * 10), int(cy * 10)), size, (cx, cy, cz),
                     "window_frame"))
        inner = (sd + 0.02, sw - 0.22, 1.02) if vertical else (sw - 0.22, sd + 0.02, 1.00)
        o.append(box("whole%d_%d" % (int(cx * 10), int(cy * 10)), inner, (cx, cy, cz),
                     "window_glass"))

    # ---- ceiling and roof -------------------------------------------------
    o.append(box("ceil", (W, D, 0.14), (0, 0, H + 0.07), "trim_white"))
    o += roof_with_fascia("roof", W, D, 1.85, H + 0.14, 0.58, "y", "roof_orange")
    o.append(box("chim", (0.5, 0.5, 1.2), (2.1, 1.3, H + 0.75), "wall_sand"))
    o.append(box("chimcap", (0.66, 0.66, 0.12), (2.1, 1.3, H + 1.41), "roof_dark"))

    # awning over the door
    o.append(wedge("awn", (3.0, 1.25, 0.5), (DOOR_CX, -hd - 0.60, 2.52), "roof_orange", "y"))
    for sx in (DOOR_CX - 1.3, DOOR_CX + 1.3):
        o.append(cylinder("ap%d" % int(sx * 10), 0.06, 2.45, 8, (sx, -hd - 1.15, 0), "metal_grey"))

    o += interior_furniture()
    return join_objects(o, "HouseOpen")


def interior_furniture():
    """Bed, rug, table, chairs, shelf and a hanging lamp."""
    W, D, T = OPEN_W, OPEN_D, OPEN_T
    hw, hd = W / 2, D / 2
    o = []

    # ---- bed, back-left corner; the sleep spot -----------------------------
    bx, by = -hw + T + 1.05, hd - T - 1.15
    o.append(box("bedframe", (1.90, 2.10, 0.34), (bx, by, 0.17), "wood_pole"))
    o.append(box("mattress", (1.76, 1.96, 0.26), (bx, by, 0.45), "trim_white"))
    o.append(box("blanket", (1.80, 1.30, 0.14), (bx, by - 0.32, 0.61), "leaf_teal"))
    o.append(box("pillow", (1.10, 0.42, 0.16), (bx, by + 0.76, 0.64), "paper_white"))
    o.append(box("headboard", (1.94, 0.12, 0.85), (bx, by + 1.05, 0.55), "wood_pole"))
    o.append(box("nightstand", (0.52, 0.52, 0.56), (bx + 1.30, by + 0.72, 0.28), "wood_light"))
    o.append(cylinder("lampbase", 0.11, 0.10, 8, (bx + 1.30, by + 0.72, 0.56), "chime_metal"))
    o.append(cylinder("lampshade", 0.20, 0.26, 10, (bx + 1.30, by + 0.72, 0.66),
                      "hat_straw", radius_top=0.14))

    # ---- rug ---------------------------------------------------------------
    o.append(box("rug", (2.5, 1.9, 0.03), (0.7, -0.5, 0.015), "boat_red"))
    o.append(box("rug2", (2.1, 1.5, 0.035), (0.7, -0.5, 0.018), "wall_sand"))

    # ---- table and chairs --------------------------------------------------
    tx, ty = 1.5, -0.5
    o.append(box("ttop", (1.35, 1.05, 0.08), (tx, ty, 0.74), "wood_light"))
    for dx, dy in ((-0.56, -0.42), (0.56, -0.42), (-0.56, 0.42), (0.56, 0.42)):
        o.append(box("tleg%d%d" % (int(dx * 10), int(dy * 10)), (0.09, 0.09, 0.70),
                     (tx + dx, ty + dy, 0.35), "wood_pole"))
    for side in (-1, 1):
        cy2 = ty + side * 0.95
        o.append(box("cseat%d" % side, (0.52, 0.50, 0.07), (tx, cy2, 0.45), "wood_light"))
        o.append(box("cback%d" % side, (0.52, 0.08, 0.52),
                     (tx, cy2 + side * 0.21, 0.72), "wood_light"))
        for dx, dy in ((-0.20, -0.19), (0.20, -0.19), (-0.20, 0.19), (0.20, 0.19)):
            o.append(box("cleg%d%d%d" % (side, int(dx * 10), int(dy * 10)),
                         (0.06, 0.06, 0.44), (tx + dx, cy2 + dy, 0.22), "wood_pole"))

    # ---- shelf and books ---------------------------------------------------
    o.append(box("shelf", (1.7, 0.30, 0.07), (0.4, hd - T - 0.16, 1.55), "wood_light"))
    o.append(box("shelf2", (1.7, 0.30, 0.07), (0.4, hd - T - 0.16, 2.02), "wood_light"))
    for i in range(9):
        o.append(box("bk%d" % i, (0.09 + (i % 3) * 0.02, 0.22, 0.26 + (i % 4) * 0.04),
                     (-0.28 + i * 0.15, hd - T - 0.16, 1.72 + (i % 2) * 0.47),
                     ["boat_red", "leaf_teal", "door_navy", "hat_band"][i % 4]))

    # ---- hanging lamp ------------------------------------------------------
    o.append(box("cord", (0.03, 0.03, 0.62), (0.4, -0.6, OPEN_H - 0.31), "pole_dark"))
    o.append(cylinder("hshade", 0.34, 0.28, 12, (0.4, -0.6, OPEN_H - 0.90),
                      "trim_white", radius_top=0.10))
    o.append(cylinder("hbulb", 0.09, 0.12, 8, (0.4, -0.6, OPEN_H - 0.98), "lamp_glass"))

    return o


# --------------------------------------------------------------------------
# RoomInterior — the shared interior cell
# --------------------------------------------------------------------------
# Every front door in the world teleports into this one room. Because it lives
# far off the terrain rather than inside a building shell, it never has to
# fight the heightfield: no pad aliasing, no floor buried under a hillside.
# It is the only interior the player ever sees, so it is worth detailing.

ROOM_W, ROOM_D, ROOM_H = 8.4, 7.0, 3.05
ROOM_T = 0.16
ROOM_DOOR_W, ROOM_DOOR_H = 1.25, 2.30


def room_interior():
    W, D, H, T = ROOM_W, ROOM_D, ROOM_H, ROOM_T
    hw, hd = W / 2, D / 2
    o = []

    # ---- floor: boards with a visible seam every plank --------------------
    o.append(box("rfloor", (W, D, 0.20), (0, 0, -0.10), "wood_plank"))
    for i in range(16):
        px = -hw + W * (i + 0.5) / 16
        o.append(box("rpl%d" % i, (W / 16 * 0.09, D, 0.21), (px, 0, -0.095), "wood_pole"))

    # ---- shell -------------------------------------------------------------
    back = box("rwb", (W, T, H), (0, hd - T / 2, H / 2), "wall_cream")
    boolean_diff(back, [box("rcb", (2.10, 1.0, 1.35), (-1.6, hd - T / 2, 1.72))])
    o.append(back)

    left = box("rwl", (T, D, H), (-hw + T / 2, 0, H / 2), "wall_cream")
    boolean_diff(left, [box("rcl", (1.0, 1.90, 1.30), (-hw + T / 2, 1.1, 1.74))])
    o.append(left)

    o.append(box("rwr", (T, D, H), (hw - T / 2, 0, H / 2), "wall_cream"))

    # front wall with the doorway back out
    dl, dr = -ROOM_DOOR_W / 2, ROOM_DOOR_W / 2
    o.append(box("rwf_l", (dl + hw, T, H), ((-hw + dl) / 2, -hd + T / 2, H / 2), "wall_cream"))
    o.append(box("rwf_r", (hw - dr, T, H), ((dr + hw) / 2, -hd + T / 2, H / 2), "wall_cream"))
    o.append(box("rwf_t", (ROOM_DOOR_W, T, H - ROOM_DOOR_H),
                 (0, -hd + T / 2, (H + ROOM_DOOR_H) / 2), "wall_cream"))
    for sx in (dl - 0.07, dr + 0.07):
        o.append(box("rjamb%d" % int(sx * 100), (0.14, T + 0.12, ROOM_DOOR_H + 0.16),
                     (sx, -hd + T / 2, (ROOM_DOOR_H + 0.16) / 2), "window_frame"))
    o.append(box("rhead", (ROOM_DOOR_W + 0.36, T + 0.12, 0.16),
                 (0, -hd + T / 2, ROOM_DOOR_H + 0.08), "window_frame"))
    leaf = box("rleaf", (ROOM_DOOR_W - 0.06, 0.07, ROOM_DOOR_H - 0.07),
               (0, 0, (ROOM_DOOR_H - 0.07) / 2), "door_navy")
    rotate_verts(leaf, (0, 0, math.radians(72)), (-(ROOM_DOOR_W - 0.06) / 2, 0, 0))
    for v in leaf.data.vertices:
        v.co.x += dl + 0.03
        v.co.y += -hd + T / 2 + 0.10
    o.append(leaf)
    o.append(cylinder("rknob", 0.045, 0.09, 8, (dr - 0.24, -hd + 0.02, 1.05), "chime_metal"))

    # skirting, ceiling and a beam
    for sy, sd in ((hd - T, T), (-hd + T, T)):
        o.append(box("rskb%d" % int(sy * 10), (W, sd + 0.05, 0.14), (0, sy, 0.07), "wood_light"))
    for sx in (-hw + T, hw - T):
        o.append(box("rskl%d" % int(sx * 10), (T + 0.05, D, 0.14), (sx, 0, 0.07), "wood_light"))
    o.append(box("rceil", (W, D, 0.16), (0, 0, H + 0.08), "trim_white"))
    o.append(box("rbeam", (W, 0.24, 0.20), (0, 0.4, H - 0.10), "wood_pole"))

    # ---- windows: bright panes plus curtains -------------------------------
    for cx, cy, cz, sw, vertical in ((-1.6, hd - T / 2, 1.72, 2.10, False),
                                     (-hw + T / 2, 1.1, 1.74, 1.90, True)):
        size = (T + 0.10, sw, 1.36) if vertical else (sw, T + 0.10, 1.40)
        o.append(box("rwfrm%d" % int(cx * 10), size, (cx, cy, cz), "window_frame"))
        glass = (T + 0.02, sw - 0.24, 1.12) if vertical else (sw - 0.24, T + 0.02, 1.16)
        o.append(box("rglass%d" % int(cx * 10), glass, (cx, cy, cz), "portal_glass"))
        bar = (T + 0.04, 0.06, 1.12) if vertical else (0.06, T + 0.04, 1.16)
        o.append(box("rbar%d" % int(cx * 10), bar, (cx, cy, cz), "window_frame"))
        # curtains either side
        for s in (-1, 1):
            off = s * (sw / 2 - 0.10)
            cur = (0.10, 0.34, 1.62) if vertical else (0.34, 0.10, 1.62)
            pos = ((cx + 0.10, cy + off, cz + 0.10) if vertical
                   else (cx + off, cy - 0.10, cz + 0.10))
            o.append(box("rcur%d%d" % (int(cx * 10), s), cur, pos, "boat_red"))
        rod = (0.06, sw + 0.30, 0.06) if vertical else (sw + 0.30, 0.06, 0.06)
        o.append(box("rrod%d" % int(cx * 10), rod, (cx + 0.12 if vertical else cx,
                                                    cy if vertical else cy - 0.12,
                                                    cz + 0.82), "wood_pole"))

    o += room_furniture()
    return join_objects(o, "RoomInterior")


def room_furniture():
    W, D, T = ROOM_W, ROOM_D, ROOM_T
    hw, hd = W / 2, D / 2
    o = []

    # ---- bed, right-hand wall ---------------------------------------------
    bx, by = hw - T - 1.15, hd - T - 1.45
    o.append(box("bframe", (2.10, 2.50, 0.30), (bx, by, 0.15), "wood_pole"))
    for dx, dy in ((-0.95, -1.15), (0.95, -1.15), (-0.95, 1.15), (0.95, 1.15)):
        o.append(box("bleg%d%d" % (int(dx * 10), int(dy * 10)), (0.14, 0.14, 0.30),
                     (bx + dx, by + dy, 0.15), "wood_pole"))
    o.append(box("bmatt", (1.96, 2.36, 0.28), (bx, by, 0.44), "trim_white"))
    o.append(box("bduvet", (2.02, 1.62, 0.20), (bx, by - 0.42, 0.66), "leaf_teal"))
    o.append(box("bfold", (2.02, 0.26, 0.09), (bx, by + 0.40, 0.71), "paper_white"))
    for s in (-1, 1):
        o.append(box("bpil%d" % s, (0.86, 0.44, 0.18), (bx + s * 0.48, by + 0.94, 0.66),
                     "paper_white"))
    o.append(box("bhead", (2.16, 0.14, 1.00), (bx, by + 1.30, 0.62), "wood_light"))

    # nightstand, lamp, book
    nx, ny = bx - 1.55, by + 0.95
    o.append(box("nstand", (0.58, 0.58, 0.62), (nx, ny, 0.31), "wood_light"))
    o.append(box("ndrawer", (0.50, 0.04, 0.20), (nx, ny - 0.29, 0.42), "wood_pole"))
    o.append(cylinder("nlbase", 0.10, 0.28, 8, (nx, ny + 0.05, 0.62), "chime_metal"))
    o.append(cylinder("nlshade", 0.21, 0.26, 12, (nx, ny + 0.05, 0.88),
                      "hat_straw", radius_top=0.15))
    o.append(box("nbook", (0.20, 0.28, 0.05), (nx + 0.16, ny - 0.14, 0.65), "boat_red"))

    # ---- desk under the back window ---------------------------------------
    dx0, dy0 = -1.6, hd - T - 0.62
    o.append(box("dtop", (2.05, 0.82, 0.08), (dx0, dy0, 0.76), "wood_light"))
    for sx in (-0.92, 0.92):
        o.append(box("dside%d" % int(sx * 10), (0.08, 0.78, 0.72),
                     (dx0 + sx, dy0, 0.36), "wood_light"))
    o.append(box("ddrawer", (0.72, 0.72, 0.44), (dx0 + 0.52, dy0, 0.48), "wood_light"))
    for i in range(2):
        o.append(box("dhand%d" % i, (0.22, 0.04, 0.04),
                     (dx0 + 0.52, dy0 - 0.37, 0.36 + i * 0.22), "chime_metal"))
    # desk lamp
    o.append(cylinder("dlb", 0.11, 0.04, 10, (dx0 - 0.66, dy0 + 0.14, 0.80), "camera_body"))
    o.append(cylinder("dls", 0.028, 0.42, 6, (dx0 - 0.66, dy0 + 0.14, 0.83), "camera_body"))
    head = cylinder("dlh", 0.15, 0.20, 10, (dx0 - 0.62, dy0 + 0.06, 1.22),
                    "boat_red", radius_top=0.09)
    rotate_verts(head, (math.radians(28), 0, 0), (dx0 - 0.62, dy0 + 0.06, 1.30))
    o.append(head)
    # papers, mug, pencil pot
    o.append(box("dpaper", (0.42, 0.56, 0.02), (dx0 + 0.02, dy0 - 0.06, 0.81), "paper_white"))
    o.append(box("dpaper2", (0.40, 0.54, 0.02), (dx0 - 0.06, dy0 + 0.04, 0.83), "paper_white"))
    o.append(cylinder("dmug", 0.075, 0.13, 10, (dx0 - 0.36, dy0 - 0.22, 0.80), "trim_white"))
    o.append(cylinder("dpot", 0.075, 0.16, 8, (dx0 + 0.72, dy0 + 0.10, 0.80), "chime_metal"))
    for i in range(3):
        o.append(box("dpen%d" % i, (0.02, 0.02, 0.26),
                     (dx0 + 0.72 + (i - 1) * 0.03, dy0 + 0.10, 0.98),
                     ["boat_red", "leaf_teal", "hat_band"][i]))

    # chair
    cx2, cy2 = dx0, dy0 - 1.08
    o.append(box("cseat", (0.56, 0.54, 0.08), (cx2, cy2, 0.46), "wood_light"))
    o.append(box("cback", (0.56, 0.09, 0.60), (cx2, cy2 + 0.23, 0.78), "wood_light"))
    for dx, dy in ((-0.22, -0.21), (0.22, -0.21), (-0.22, 0.21), (0.22, 0.21)):
        o.append(box("cleg%d%d" % (int(dx * 10), int(dy * 10)), (0.06, 0.06, 0.46),
                     (cx2 + dx, cy2 + dy, 0.23), "wood_pole"))

    # ---- wardrobe, left of the door ---------------------------------------
    wx, wy = -hw + T + 0.44, -hd + T + 1.30
    o.append(box("ward", (0.82, 1.60, 2.15), (wx, wy, 1.075), "wood_light"))
    o.append(box("wardtop", (0.90, 1.70, 0.09), (wx, wy, 2.19), "wood_pole"))
    for s in (-1, 1):
        o.append(box("warddoor%d" % s, (0.05, 0.74, 1.95), (wx + 0.42, wy + s * 0.39, 1.06),
                     "wood_pole"))
        o.append(cylinder("wardknob%d" % s, 0.035, 0.06, 8,
                          (wx + 0.46, wy + s * 0.07, 1.10), "chime_metal"))
    o.append(box("wardbox", (0.52, 0.62, 0.34), (wx, wy - 0.30, 2.41), "boat_wood"))

    # ---- bookshelf ---------------------------------------------------------
    sx0, sy0 = hw - T - 0.24, -hd + T + 1.25
    o.append(box("shback", (0.10, 1.70, 1.85), (sx0 + 0.14, sy0, 0.92), "wood_pole"))
    for i in range(4):
        o.append(box("shelf%d" % i, (0.42, 1.70, 0.06), (sx0, sy0, 0.28 + i * 0.50),
                     "wood_light"))
    cols = ["boat_red", "leaf_teal", "door_navy", "hat_band", "camera_body"]
    for i in range(22):
        row = i // 6
        col = i % 6
        o.append(box("bk%d" % i, (0.26, 0.10 + (i % 3) * 0.02, 0.28 + (i % 4) * 0.05),
                     (sx0, sy0 - 0.70 + col * 0.25, 0.45 + row * 0.50 + (i % 4) * 0.02),
                     cols[i % 5]))

    # ---- rug ---------------------------------------------------------------
    o.append(box("rug1", (3.0, 2.2, 0.025), (-0.5, -0.9, 0.012), "boat_red"))
    o.append(box("rug2", (2.6, 1.8, 0.03), (-0.5, -0.9, 0.016), "wall_sand"))
    o.append(box("rug3", (1.7, 1.1, 0.035), (-0.5, -0.9, 0.020), "boat_red"))

    # ---- pictures on the right wall ---------------------------------------
    for i, (py, pz, ph) in enumerate(((-0.4, 2.05, 0.52), (0.55, 2.20, 0.40),
                                      (0.35, 1.62, 0.34))):
        o.append(box("pfrm%d" % i, (0.05, ph * 1.35, ph), (hw - T - 0.03, py, pz),
                     "wood_pole"))
        o.append(box("pimg%d" % i, (0.02, ph * 1.35 - 0.09, ph - 0.09),
                     (hw - T - 0.06, py, pz),
                     ["leaf_mid", "wall_pink", "window_glass"][i]))

    # ---- plant in the corner ----------------------------------------------
    px, py2 = -hw + T + 0.55, hd - T - 0.75
    o.append(cylinder("ppot", 0.30, 0.42, 12, (px, py2, 0), "boat_red", radius_top=0.36))
    o.append(cylinder("psoil", 0.34, 0.04, 12, (px, py2, 0.40), "trunk_brown"))
    for i in range(7):
        a = i * math.tau / 7
        o.append(ico_blob("pleaf%d" % i, 0.30, (px + math.cos(a) * 0.26,
                                                py2 + math.sin(a) * 0.26,
                                                0.66 + (i % 3) * 0.24),
                          1, 0.26, 40 + i, (1.0, 1.0, 0.72), "leaf_mid"))
    o.append(cylinder("pstem", 0.05, 0.70, 6, (px, py2, 0.40), "trunk_brown"))

    # ---- ceiling pendant ---------------------------------------------------
    o.append(box("pcord", (0.035, 0.035, 0.55), (0.6, -0.4, ROOM_H - 0.28), "pole_dark"))
    o.append(cylinder("pshade", 0.38, 0.30, 14, (0.6, -0.4, ROOM_H - 0.86),
                      "trim_white", radius_top=0.12))
    o.append(cylinder("pbulb", 0.10, 0.13, 8, (0.6, -0.4, ROOM_H - 0.94), "lamp_glass"))

    # ---- trunk at the foot of the bed --------------------------------------
    o.append(box("trunkbox", (1.30, 0.60, 0.52), (hw - T - 1.15, -0.55, 0.26), "boat_wood"))
    o.append(box("trunklid", (1.36, 0.66, 0.09), (hw - T - 1.15, -0.55, 0.55), "wood_pole"))
    for s in (-1, 1):
        o.append(box("trunkband%d" % s, (0.10, 0.64, 0.56),
                     (hw - T - 1.15 + s * 0.48, -0.55, 0.28), "chime_metal"))
    return o


def build():
    reset_scene()
    objs = [house_large(), house_small(), house_solar(), porch_house(), shed(),
            house_open(), room_interior()]
    info = export_glb(objs, "buildings.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
