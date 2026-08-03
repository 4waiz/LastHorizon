"""
LastHorizon — original stylized vegetation and rocks.

Exports `public/assets/models/nature.glb`:

    TreeBig / TreeMed / TreeSmall   faceted canopy masses on a tapered trunk
    Palm                            curved trunk with radiating fronds
    DeadTree                        bare branching silhouette
    BushA / BushB                   low clustered masses
    RockA / RockB / RockC           angular boulders, pale and dark
    GrassTuft                       four crossed blades, for InstancedMesh

Canopies are built from jittered icospheres in two greens: a dark base mass
and lighter caps sitting on the sun-facing top. That layering is what stops
low-poly foliage from reading as a plain green ball.
"""

import math
import os
import random
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, cylinder, tube_along, ico_blob, mesh_from, rotate_verts,
    join_objects, export_glb, tri_count,
)


def trunk(name, height, r0, r1, lean=0.0, seed=0, mat="trunk_brown", verts=7):
    rng = random.Random(seed)
    pts = []
    steps = 4
    for i in range(steps + 1):
        t = i / steps
        pts.append((math.sin(t * 1.4) * lean + rng.uniform(-0.02, 0.02) * t,
                    rng.uniform(-0.02, 0.02) * t,
                    t * height))
    return tube_along(name, pts, r0, verts, mat,
                      taper=lambda t: 1.0 - (1.0 - r1 / r0) * t)


def canopy(prefix, blobs, seed):
    """blobs: (x, y, z, radius, flatten, mat)"""
    out = []
    for i, (x, y, z, r, fl, mat) in enumerate(blobs):
        out.append(ico_blob("%s_c%d" % (prefix, i), r, (x, y, z), subdiv=1,
                            jitter=0.30, seed=seed + i * 17,
                            scale=(1.0, 1.0, fl), mat_key=mat))
    return out


def tree_big():
    o = [trunk("t", 4.3, 0.30, 0.17, 0.12, 3)]
    for a, l, up in ((0.5, 1.5, 3.1), (3.4, 1.3, 3.5), (1.9, 1.1, 2.6)):
        o.append(tube_along("br%d" % int(a * 10), [
            (math.cos(a) * 0.12, math.sin(a) * 0.12, up),
            (math.cos(a) * l * 0.6, math.sin(a) * l * 0.6, up + 0.55),
            (math.cos(a) * l, math.sin(a) * l, up + 0.85),
        ], 0.10, 5, "trunk_brown", taper=lambda t: 1.0 - 0.6 * t))
    o += canopy("big", [
        (0.00, 0.00, 5.35, 2.35, 0.78, "leaf_dark"),
        (-1.75, 0.85, 4.70, 1.55, 0.80, "leaf_dark"),
        (1.85, -0.55, 4.85, 1.65, 0.78, "leaf_dark"),
        (0.55, 1.75, 4.55, 1.35, 0.82, "leaf_teal"),
        (-0.45, -1.65, 4.95, 1.30, 0.80, "leaf_teal"),
        (0.15, 0.20, 6.55, 1.55, 0.62, "leaf_mid"),
        (-1.35, -0.35, 6.05, 1.05, 0.60, "leaf_mid"),
        (1.35, 0.75, 5.95, 1.00, 0.60, "leaf_light"),
    ], 11)
    return join_objects(o, "TreeBig")


def tree_med():
    o = [trunk("t", 3.1, 0.22, 0.13, -0.10, 21)]
    o += canopy("med", [
        (0.00, 0.00, 3.95, 1.70, 0.80, "leaf_dark"),
        (-1.20, 0.45, 3.55, 1.10, 0.82, "leaf_dark"),
        (1.15, -0.40, 3.60, 1.15, 0.80, "leaf_teal"),
        (0.10, 0.15, 4.80, 1.10, 0.62, "leaf_mid"),
        (-0.85, -0.55, 4.35, 0.80, 0.62, "leaf_light"),
    ], 47)
    return join_objects(o, "TreeMed")


def tree_small():
    o = [trunk("t", 1.95, 0.15, 0.09, 0.07, 63)]
    o += canopy("sml", [
        (0.00, 0.00, 2.45, 1.10, 0.82, "leaf_dark"),
        (-0.70, 0.30, 2.20, 0.72, 0.84, "leaf_teal"),
        (0.60, -0.30, 2.25, 0.70, 0.82, "leaf_dark"),
        (0.05, 0.05, 3.05, 0.70, 0.64, "leaf_mid"),
    ], 91)
    return join_objects(o, "TreeSmall")


def frond(name, base, azim, length, rise, droop, width, mat="palm_frond"):
    """A broad palm blade: midrib spine with edges folded slightly below it.

    Rendered single-sided pointing up; the runtime gives foliage materials
    DoubleSide so the underside is still visible from below.
    """
    ca, sa = math.cos(azim), math.sin(azim)
    px, py = -sa, ca
    n = 7
    verts, faces = [], []
    for i in range(n):
        t = i / (n - 1)
        z = base[2] + rise * math.sin(t * 1.7) - droop * t ** 2.6
        cx = base[0] + ca * length * t
        cy = base[1] + sa * length * t
        w = width * (0.16 + 0.84 * math.sin(t * math.pi))
        verts.append((cx, cy, z))
        verts.append((cx + px * w, cy + py * w, z - w * 0.42))
        verts.append((cx - px * w, cy - py * w, z - w * 0.42))
    for i in range(n - 1):
        a, b = 3 * i, 3 * (i + 1)
        faces.append((a, b, b + 1, a + 1))
        faces.append((a + 2, b + 2, b, a))
    return mesh_from(name, verts, faces, mat)


def palm():
    H = 6.6
    pts = [(0, 0, 0)]
    for i in range(1, 7):
        t = i / 6
        pts.append((math.sin(t * 1.05) * 0.85, 0.10 * t, t * H))
    o = [tube_along("trunk", pts, 0.20, 7, "trunk_grey",
                    taper=lambda t: 1.0 - 0.45 * t)]
    for i in range(7):
        z = 0.55 + i * 0.72
        t = z / H
        o.append(cylinder("ring%d" % i, 0.175 - 0.055 * t, 0.09, 7,
                          (math.sin(t * 1.05) * 0.85, 0.10 * t, z), "trunk_brown"))

    top = (math.sin(1.05) * 0.85, 0.10, H - 0.10)
    for i in range(10):
        a = i * math.tau / 10 + 0.25
        o.append(frond("fr%d" % i, top, a,
                       2.35 + 0.32 * ((i * 7) % 3),
                       0.55 + 0.12 * (i % 2),
                       1.85 + 0.30 * (i % 3),
                       0.30 + 0.05 * (i % 2)))
    o.append(ico_blob("crown", 0.34, top, 1, 0.22, 5, (1, 1, 0.85), "palm_frond"))
    return join_objects(o, "Palm")


def dead_tree():
    o = [trunk("t", 3.4, 0.24, 0.10, 0.16, 7, "trunk_grey")]
    rng = random.Random(5)
    for i in range(6):
        a = i * math.tau / 6 + 0.4
        base_z = 1.7 + (i % 3) * 0.62
        l = rng.uniform(1.0, 1.8)
        o.append(tube_along("b%d" % i, [
            (math.cos(a) * 0.12, math.sin(a) * 0.12, base_z),
            (math.cos(a) * l * 0.55, math.sin(a) * l * 0.55, base_z + l * 0.55),
            (math.cos(a) * l, math.sin(a) * l, base_z + l * 1.05),
        ], 0.085, 5, "trunk_grey", taper=lambda t: 1.0 - 0.75 * t))
    return join_objects(o, "DeadTree")


def bush(name, blobs, seed):
    return join_objects(canopy(name, blobs, seed), name)


def rock(name, r, scale, seed, mat, subdiv=1, jitter=0.34):
    obj = ico_blob(name, r, (0, 0, 0), subdiv, jitter, seed, scale, mat,
                   flatten_bottom=-r * scale[2] * 0.45)
    lo = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.z -= lo
    return obj


def grass_tuft():
    """Four crossed blades; drawn thousands of times through InstancedMesh."""
    o = []
    for i in range(4):
        a = i * math.pi / 4 + 0.3
        c, s = math.cos(a), math.sin(a)
        w, h = 0.042, 0.34 + 0.07 * (i % 2)
        v = [(-w * c, -w * s, 0.0), (w * c, w * s, 0.0),
             (w * c * 0.35, w * s * 0.35, h), (-w * c * 0.35, -w * s * 0.35, h)]
        o.append(mesh_from("bl%d" % i, v, [(0, 1, 2, 3)], "grass_green"))
    return join_objects(o, "GrassTuft")


def build():
    reset_scene()
    objs = [
        tree_big(), tree_med(), tree_small(), palm(), dead_tree(),
        bush("BushA", [
            (0.00, 0.00, 0.62, 0.90, 0.72, "bush_dark"),
            (-0.62, 0.30, 0.50, 0.62, 0.74, "bush_dark"),
            (0.58, -0.26, 0.52, 0.66, 0.72, "bush_mid"),
            (0.05, 0.10, 1.02, 0.55, 0.60, "bush_mid"),
        ], 5),
        bush("BushB", [
            (0.00, 0.00, 0.46, 0.68, 0.70, "bush_dark"),
            (-0.48, -0.20, 0.40, 0.48, 0.72, "bush_mid"),
            (0.42, 0.26, 0.42, 0.50, 0.70, "bush_dark"),
        ], 29),
        rock("RockA", 1.35, (1.25, 1.0, 0.72), 3, "rock_light"),
        rock("RockB", 0.85, (1.05, 1.25, 0.62), 17, "rock_dark"),
        rock("RockC", 0.42, (1.20, 0.95, 0.66), 41, "rock_mid"),
        grass_tuft(),
    ]
    info = export_glb(objs, "nature.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
