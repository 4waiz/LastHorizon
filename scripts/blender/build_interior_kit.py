"""
LastHorizon — modular interior kit.

Exports `public/assets/models/interior_kit.glb`: a small set of parts that are
assembled into every enterable building by `src/world/interiors/`. The layouts
live in TypeScript data, not here, which is the whole point — nine interiors
out of one 28-part kit rather than nine hand-modelled rooms.

Conventions, on top of the ones in lh_common:

* **A 2 m module.** Floors, ceilings and wall segments are exactly 2.0 m on
  their long axis so a layout can be authored on integer grid coordinates.
* **Walls run along X**, thickness along Y, origin on the floor line at the
  segment's centre. A layout places a wall on a cell edge and yaws it; there is
  no separate "wall facing Z" part.
* **Furniture faces -Y in Blender (+Z in Three.js)** with its origin on the
  floor at the footprint centre, so placement is position + yaw, same as every
  exterior prop.
* Window glass is `portal_glass` so the hero interiors can swap it for a live
  render target; the rest keep it as an ordinary toon material.

The room's usable height is WALL_H; the ceiling panel sits on top of it.
"""

import bpy  # noqa: F401  (imported for parity with the other build scripts)
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, cylinder, join_objects, export_glb, tri_count,
)

import math  # noqa: E402


# --------------------------------------------------------------------------
# Grid. These numbers are mirrored in src/world/interiors/InteriorKit.ts and
# asserted against it by tests/interiorKit.test.ts — change both or neither.
# --------------------------------------------------------------------------

MODULE = 2.00
WALL_H = 3.00
WALL_T = 0.16
DOOR_W = 1.30
DOOR_H = 2.35
WIN_W = 1.20
WIN_H = 1.30
WIN_SILL = 0.95

HM = MODULE / 2.0
HT = WALL_T / 2.0


# --------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------

def floor_tile(name="KitFloor", mat="floor_wood"):
    """2x2 floor panel. Walking surface is z = 0; the slab hangs below it."""
    return join_objects([box(name + "_s", (MODULE, MODULE, 0.12), (0, 0, -0.06), mat)], name)


def ceiling_tile():
    return join_objects(
        [box("c_s", (MODULE, MODULE, 0.10), (0, 0, WALL_H + 0.05), "wall_inner")],
        "KitCeiling",
    )


def wall_solid():
    o = [box("w_s", (MODULE, WALL_T, WALL_H), (0, 0, WALL_H / 2), "wall_inner")]
    # A skirting board reads as "finished room" for 12 triangles.
    for s in (-1, 1):
        o.append(box("w_sk%d" % s, (MODULE, 0.03, 0.11),
                     (0, s * (HT + 0.015), 0.055), "wall_accent"))
    return join_objects(o, "KitWall")


def wall_window():
    """Solid wall with a glazed opening. Built from parts, not a boolean —
    five boxes are cheaper than an exact-solver carve and give clean quads."""
    pier = (MODULE - WIN_W) / 2.0
    top_h = WALL_H - (WIN_SILL + WIN_H)
    o = [
        box("ww_l", (pier, WALL_T, WALL_H), (-(WIN_W + pier) / 2, 0, WALL_H / 2), "wall_inner"),
        box("ww_r", (pier, WALL_T, WALL_H), ((WIN_W + pier) / 2, 0, WALL_H / 2), "wall_inner"),
        box("ww_b", (WIN_W, WALL_T, WIN_SILL), (0, 0, WIN_SILL / 2), "wall_inner"),
        box("ww_t", (WIN_W, WALL_T, top_h), (0, 0, WALL_H - top_h / 2), "wall_inner"),
        # Reveal frame, then the pane itself.
        box("ww_f", (WIN_W + 0.10, WALL_T * 0.55, WIN_H + 0.10),
            (0, 0, WIN_SILL + WIN_H / 2), "window_frame"),
        box("ww_g", (WIN_W, 0.04, WIN_H), (0, 0, WIN_SILL + WIN_H / 2), "portal_glass"),
        box("ww_sill", (WIN_W + 0.22, WALL_T + 0.14, 0.06),
            (0, 0, WIN_SILL - 0.03), "wall_accent"),
    ]
    # Skirting on both faces, like KitWall — a window segment sitting in the
    # same run as a solid one must not show a skirting board that stops dead.
    for sx in (-1, 1):
        for sy in (-1, 1):
            o.append(box("ww_sk%d%d" % (sx, sy), (pier, 0.03, 0.11),
                         (sx * (WIN_W + pier) / 2, sy * (HT + 0.015), 0.055), "wall_accent"))
    return join_objects(o, "KitWallWindow")


def wall_door():
    """Wall with a doorway hole. The leaf is a separate part so a layout can
    leave a shop's doorway standing open and a bedroom's closed."""
    pier = (MODULE - DOOR_W) / 2.0
    lintel = WALL_H - DOOR_H
    o = [
        box("wd_l", (pier, WALL_T, WALL_H), (-(DOOR_W + pier) / 2, 0, WALL_H / 2), "wall_inner"),
        box("wd_r", (pier, WALL_T, WALL_H), ((DOOR_W + pier) / 2, 0, WALL_H / 2), "wall_inner"),
        box("wd_t", (DOOR_W, WALL_T, lintel), (0, 0, WALL_H - lintel / 2), "wall_inner"),
        # Architrave, both faces.
        box("wd_j1", (0.07, WALL_T + 0.06, DOOR_H), (-DOOR_W / 2, 0, DOOR_H / 2), "wall_accent"),
        box("wd_j2", (0.07, WALL_T + 0.06, DOOR_H), (DOOR_W / 2, 0, DOOR_H / 2), "wall_accent"),
        box("wd_h", (DOOR_W + 0.14, WALL_T + 0.06, 0.07), (0, 0, DOOR_H), "wall_accent"),
    ]
    return join_objects(o, "KitWallDoor")


def door_leaf():
    o = [
        box("dl_p", (DOOR_W - 0.06, 0.05, DOOR_H - 0.05),
            (0, 0, (DOOR_H - 0.05) / 2), "door_wood"),
        box("dl_k", (0.10, 0.10, 0.10), (DOOR_W / 2 - 0.20, -0.06, 1.05), "metal_light"),
    ]
    # Two sunk panels, suggested with thin raised frames rather than a carve.
    for i, cz in enumerate((0.62, 1.72)):
        o.append(box("dl_f%d" % i, (DOOR_W - 0.34, 0.055, 0.62),
                     (0, 0, cz), "wall_accent"))
    return join_objects(o, "KitDoorLeaf")


# --------------------------------------------------------------------------
# Furniture
# --------------------------------------------------------------------------

def counter():
    """2 m service counter. The player stands on -Y, the clerk on +Y."""
    o = [
        box("ct_b", (MODULE, 0.62, 0.94), (0, 0.04, 0.47), "counter_top"),
        box("ct_t", (MODULE + 0.10, 0.76, 0.07), (0, 0, 0.975), "wall_accent"),
        box("ct_k", (MODULE - 0.10, 0.03, 0.34), (0, -0.28, 0.28), "wall_accent"),
    ]
    return join_objects(o, "KitCounter")


def shelf_unit():
    o = [
        box("sh_bk", (1.60, 0.05, 1.90), (0, 0.21, 0.95), "wall_accent"),
        box("sh_l", (0.05, 0.46, 1.90), (-0.775, 0, 0.95), "wood_plank"),
        box("sh_r", (0.05, 0.46, 1.90), (0.775, 0, 0.95), "wood_plank"),
    ]
    for i in range(4):
        o.append(box("sh_s%d" % i, (1.50, 0.44, 0.04), (0, 0, 0.30 + i * 0.48), "wood_plank"))
    return join_objects(o, "KitShelf")


def desk():
    o = [
        box("dk_t", (1.50, 0.72, 0.05), (0, 0, 0.735), "wood_plank"),
        box("dk_m", (0.44, 0.62, 0.68), (0.48, 0.02, 0.34), "wall_accent"),
    ]
    for sy in (-0.30, 0.30):
        o.append(box("dk_lg%d" % int(sy * 10), (0.06, 0.06, 0.71),
                     (-0.70, sy, 0.355), "wood_pole"))
    return join_objects(o, "KitDesk")


def chair():
    o = [
        box("ch_s", (0.46, 0.44, 0.05), (0, 0, 0.44), "wood_plank"),
        box("ch_b", (0.44, 0.05, 0.46), (0, 0.20, 0.69), "wood_plank"),
    ]
    for sx in (-0.19, 0.19):
        for sy in (-0.18, 0.18):
            o.append(box("ch_l%d%d" % (int(sx * 100), int(sy * 100)),
                         (0.045, 0.045, 0.42), (sx, sy, 0.21), "wood_pole"))
    return join_objects(o, "KitChair")


def stool():
    o = [cylinder("st_s", 0.19, 0.05, 10, (0, 0, 0.62), "fabric_warm")]
    for a in range(3):
        ang = a * math.tau / 3
        o.append(box("st_l%d" % a, (0.045, 0.045, 0.62),
                     (math.cos(ang) * 0.14, math.sin(ang) * 0.14, 0.31), "steel_dark"))
    return join_objects(o, "KitStool")


def table_round():
    o = [
        cylinder("tb_t", 0.42, 0.05, 14, (0, 0, 0.72), "wood_plank"),
        cylinder("tb_p", 0.06, 0.72, 8, (0, 0, 0), "steel_dark"),
        cylinder("tb_f", 0.28, 0.03, 12, (0, 0, 0), "steel_dark"),
    ]
    return join_objects(o, "KitTable")


def bed():
    o = [
        box("bd_f", (1.05, 2.05, 0.28), (0, 0, 0.20), "wood_plank"),
        box("bd_m", (1.00, 1.96, 0.20), (0, 0, 0.44), "shirt"),
        box("bd_q", (1.03, 1.30, 0.07), (0, 0.30, 0.57), "fabric_blue"),
        box("bd_p", (0.62, 0.34, 0.12), (0, -0.76, 0.60), "shirt"),
        box("bd_h", (1.10, 0.07, 0.72), (0, -1.02, 0.36), "wood_pole"),
    ]
    return join_objects(o, "KitBed")


def wardrobe():
    o = [
        box("wr_b", (1.10, 0.58, 2.00), (0, 0.02, 1.00), "wood_plank"),
        box("wr_d1", (0.52, 0.04, 1.86), (-0.27, -0.29, 1.00), "wall_accent"),
        box("wr_d2", (0.52, 0.04, 1.86), (0.27, -0.29, 1.00), "wall_accent"),
        box("wr_h1", (0.05, 0.05, 0.16), (-0.05, -0.33, 1.05), "metal_light"),
        box("wr_h2", (0.05, 0.05, 0.16), (0.05, -0.33, 1.05), "metal_light"),
    ]
    return join_objects(o, "KitWardrobe")


def locker_bank():
    o = [box("lk_b", (1.20, 0.48, 1.90), (0, 0, 0.95), "steel_dark")]
    for i in range(3):
        x = -0.40 + i * 0.40
        o.append(box("lk_d%d" % i, (0.36, 0.04, 1.82), (x, -0.25, 0.95), "metal_grey"))
        o.append(box("lk_v%d" % i, (0.22, 0.03, 0.05), (x, -0.28, 1.62), "steel_dark"))
    return join_objects(o, "KitLocker")


def shower():
    """Corner cubicle. Open on -Y so the player walks in facing +Y."""
    o = [
        box("sw_tray", (0.92, 0.92, 0.10), (0, 0, 0.05), "clinic_white"),
        box("sw_bk", (0.92, 0.05, 2.00), (0, 0.435, 1.00), "clinic_mint"),
        box("sw_sd", (0.05, 0.92, 2.00), (0.435, 0, 1.00), "clinic_mint"),
        box("sw_g", (0.04, 0.86, 1.80), (-0.42, 0.02, 1.05), "window_glass"),
        box("sw_hd", (0.20, 0.20, 0.06), (0, 0.24, 1.92), "metal_light"),
        box("sw_pp", (0.05, 0.05, 0.40), (0, 0.40, 1.90), "metal_light"),
        box("sw_tp", (0.14, 0.06, 0.06), (0.20, 0.40, 1.10), "metal_light"),
    ]
    return join_objects(o, "KitShower")


def wall_sign():
    """Hangs on a wall; the layout gives it a z offset."""
    o = [
        box("sg_b", (1.40, 0.06, 0.44), (0, 0, 0), "sign_board"),
        box("sg_f", (1.46, 0.04, 0.50), (0, 0.02, 0), "wall_accent"),
    ]
    return join_objects(o, "KitSign")


def planter():
    o = [
        cylinder("pl_p", 0.26, 0.38, 12, (0, 0, 0), "boat_red", radius_top=0.31),
        cylinder("pl_s", 0.29, 0.03, 12, (0, 0, 0.36), "trunk_brown"),
        cylinder("pl_st", 0.04, 0.52, 6, (0, 0, 0.36), "trunk_brown"),
    ]
    for i in range(5):
        a = i * math.tau / 5
        o.append(box("pl_lf%d" % i, (0.30, 0.10, 0.03),
                     (math.cos(a) * 0.19, math.sin(a) * 0.19, 0.80 + (i % 2) * 0.10),
                     "leaf_mid"))
    return join_objects(o, "KitPlanter")


def crate():
    o = [box("ck_b", (0.58, 0.58, 0.46), (0, 0, 0.23), "wood_light")]
    for s in (-1, 1):
        o.append(box("ck_r%d" % s, (0.60, 0.05, 0.06), (0, s * 0.28, 0.40), "wood_pole"))
    return join_objects(o, "KitCrate")


# --------------------------------------------------------------------------
# Hero props — one per service, so each interior has something that is only
# its own. Kept to a few hundred triangles each.
# --------------------------------------------------------------------------

def fridge_case():
    o = [
        box("fr_b", (1.60, 0.70, 1.90), (0, 0.06, 0.95), "metal_light"),
        box("fr_g", (1.44, 0.04, 1.44), (0, -0.30, 1.06), "window_glass"),
        box("fr_k", (1.60, 0.72, 0.16), (0, 0.06, 0.08), "steel_dark"),
    ]
    for i in range(3):
        o.append(box("fr_s%d" % i, (1.40, 0.56, 0.04), (0, 0.10, 0.52 + i * 0.46), "metal_grey"))
    return join_objects(o, "KitFridge")


def till():
    """Sits on a counter. Origin at its own base, not the floor."""
    o = [
        box("tl_b", (0.42, 0.36, 0.16), (0, 0, 0.08), "steel_dark"),
        box("tl_d", (0.40, 0.30, 0.10), (0, -0.02, 0.21), "metal_light"),
        box("tl_s", (0.30, 0.04, 0.20), (0, 0.14, 0.34), "camera_body"),
    ]
    return join_objects(o, "KitTill")


def clinic_bed():
    o = [
        box("cb_m", (0.78, 1.96, 0.16), (0, 0, 0.68), "clinic_mint"),
        box("cb_f", (0.72, 1.90, 0.14), (0, 0, 0.54), "clinic_white"),
        box("cb_h", (0.76, 0.06, 0.42), (0, -1.00, 0.88), "metal_grey"),
    ]
    for sx in (-0.32, 0.32):
        for sy in (-0.86, 0.86):
            o.append(box("cb_l%d%d" % (int(sx * 100), int(sy * 100)),
                         (0.05, 0.05, 0.47), (sx, sy, 0.235), "metal_grey"))
    return join_objects(o, "KitClinicBed")


def cell_bars():
    """A 2 m barred wall. Sits in a doorway or across an alcove."""
    o = [
        box("cl_t", (MODULE, 0.10, 0.10), (0, 0, WALL_H - 0.05), "steel_dark"),
        box("cl_b", (MODULE, 0.10, 0.10), (0, 0, 0.05), "steel_dark"),
    ]
    for i in range(11):
        x = -0.90 + i * 0.18
        o.append(box("cl_v%d" % i, (0.05, 0.05, WALL_H - 0.10), (x, 0, WALL_H / 2), "steel_dark"))
    return join_objects(o, "KitCellBars")


def tool_bench():
    o = [
        box("tbn_b", (2.00, 0.68, 0.86), (0, 0.04, 0.43), "steel_dark"),
        box("tbn_t", (2.06, 0.74, 0.06), (0, 0, 0.89), "wood_plank"),
        box("tbn_p", (1.90, 0.04, 0.90), (0, 0.32, 1.50), "wall_accent"),
    ]
    # A few tools hinted on the pegboard.
    for i in range(4):
        o.append(box("tbn_h%d" % i, (0.06, 0.03, 0.30),
                     (-0.66 + i * 0.44, 0.29, 1.44 + (i % 2) * 0.14), "metal_grey"))
    return join_objects(o, "KitToolBench")


def car_lift():
    o = [box("li_p", (2.40, 1.60, 0.10), (0, 0, 0.05), "floor_screed")]
    for sx in (-1.10, 1.10):
        o.append(box("li_c%d" % int(sx), (0.24, 0.30, 2.60), (sx, 0.55, 1.30), "beacon_red"))
        o.append(box("li_a%d" % int(sx), (0.16, 1.10, 0.14), (sx, 0.05, 0.42), "steel_dark"))
    o.append(box("li_x", (2.44, 0.20, 0.16), (0, 0.55, 2.52), "steel_dark"))
    return join_objects(o, "KitCarLift")


def coffee_bar():
    o = [
        box("cf_b", (0.92, 0.54, 0.44), (0, 0, 0.22), "metal_light"),
        box("cf_t", (0.92, 0.54, 0.14), (0, 0.06, 0.51), "steel_dark"),
        box("cf_g", (0.20, 0.20, 0.34), (0.30, 0.02, 0.61), "metal_grey"),
    ]
    for sx in (-0.24, 0.02):
        o.append(cylinder("cf_h%d" % int(sx * 100), 0.035, 0.16, 8, (sx, -0.22, 0.28),
                          "steel_dark"))
    return join_objects(o, "KitCoffeeBar")


def clothing_rack():
    o = [
        box("cr_r", (1.60, 0.05, 0.05), (0, 0, 1.62), "metal_light"),
        box("cr_f", (0.70, 0.60, 0.05), (0, 0, 0.03), "steel_dark"),
    ]
    for sx in (-0.72, 0.72):
        o.append(box("cr_p%d" % int(sx * 100), (0.06, 0.06, 1.62), (sx, 0, 0.81), "metal_light"))
    # Hanging garments, alternating colours so the rack reads as full.
    for i in range(7):
        mat = ("fabric_blue", "shirt", "fabric_warm", "shop_green")[i % 4]
        o.append(box("cr_g%d" % i, (0.13, 0.34, 0.86),
                     (-0.62 + i * 0.21, 0, 1.14), mat))
    return join_objects(o, "KitClothingRack")


def flight_desk():
    o = [
        box("fd_b", (1.80, 0.74, 0.74), (0, 0.04, 0.37), "police_navy"),
        box("fd_t", (1.90, 0.82, 0.06), (0, 0, 0.77), "steel_dark"),
    ]
    for i, sx in enumerate((-0.50, 0.16)):
        o.append(box("fd_m%d" % i, (0.56, 0.05, 0.36), (sx, 0.26, 1.00), "camera_body"))
        o.append(box("fd_s%d" % i, (0.50, 0.02, 0.30), (sx, 0.23, 1.00), "lamp_glass"))
        o.append(box("fd_st%d" % i, (0.10, 0.14, 0.14), (sx, 0.26, 0.87), "camera_body"))
    o.append(box("fd_r", (0.44, 0.30, 0.22), (0.70, 0.16, 0.91), "steel_dark"))
    return join_objects(o, "KitFlightDesk")


# --------------------------------------------------------------------------

def build():
    reset_scene()
    objs = [
        # shell
        floor_tile("KitFloor", "floor_wood"),
        floor_tile("KitFloorTile", "floor_tile"),
        floor_tile("KitFloorScreed", "floor_screed"),
        ceiling_tile(),
        wall_solid(),
        wall_window(),
        wall_door(),
        door_leaf(),
        # furniture
        counter(),
        shelf_unit(),
        desk(),
        chair(),
        stool(),
        table_round(),
        bed(),
        wardrobe(),
        locker_bank(),
        shower(),
        wall_sign(),
        planter(),
        crate(),
        # hero props
        fridge_case(),
        till(),
        clinic_bed(),
        cell_bars(),
        tool_bench(),
        car_lift(),
        coffee_bar(),
        clothing_rack(),
        flight_desk(),
    ]
    info = export_glb(objs, "interior_kit.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
