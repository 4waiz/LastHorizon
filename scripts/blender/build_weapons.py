"""
LastHorizon — the three firearms, and nothing that looks like a real one.

Exports `public/assets/models/weapons.glb`:

    Pistol, Shotgun, Carbine

Every one is an original silhouette built from boxes and cylinders: no
downloaded model, no brand, no marking, no proportion traced from a real
product. They are deliberately *toy-like* — chunky, rounded, unmistakably part
of the same low-poly world as the bicycles and the mailboxes — because a
photoreal weapon in this game would be the one object that breaks the tone
`docs/GAME_VISION.md` spends six pillars establishing.

Materials come from the shared palette (`metal_grey`, `pole_dark`,
`wood_plank`), so all three collapse onto material keys the rest of the kit
already uses and add no new shader programs.

Each is modelled with the grip at the origin and the barrel down +Z, which is
what the `weapon` socket in `src/player/Sockets.ts` expects: it attaches to
`hand.R` with no rotation, so the model's own axes are the hand's axes.

From a terminal:

    blender --background --python scripts/blender/build_weapons.py
"""

import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, box, cylinder, bevel, rotate_verts,
    join_objects, export_glb, tri_count,
)

# Grip at the origin, barrel along +Z. Matches the `weapon` socket.
#
# `lh_common.cylinder` builds along +Z from a *base* point rather than about a
# centre, and takes no axis argument — so every barrel below is positioned by
# where it starts, not where its middle is. Worth stating because getting it
# wrong puts a barrel half inside the receiver and looks like a modelling
# mistake rather than an arithmetic one.
METAL = "metal_grey"
DARK = "pole_dark"
WOOD = "wood_plank"


def pistol():
    """A blocky service sidearm, about 19 cm long."""
    parts = []

    # Slide and frame — one wedge-ish stack rather than a modelled action.
    parts.append(box("slide", (0.032, 0.040, 0.150), (0, 0.052, 0.030), METAL))
    parts.append(box("frame", (0.030, 0.032, 0.110), (0, 0.022, 0.018), DARK))

    # Grip, raked back. Rotated rather than sheared: cheaper and reads better
    # at the size this is actually seen.
    grip = box("grip", (0.028, 0.086, 0.038), (0, -0.030, -0.014), DARK)
    rotate_verts(grip, (0.28, 0, 0), pivot=(0, 0.010, 0))
    parts.append(grip)

    # Trigger guard, as a ring of two bars. Nobody counts the polygons here.
    parts.append(box("guard_front", (0.020, 0.026, 0.008), (0, 0.000, 0.028), DARK))
    parts.append(box("guard_under", (0.020, 0.008, 0.034), (0, -0.012, 0.012), DARK))

    # Muzzle, and a front sight so the silhouette is not a plain slab.
    parts.append(cylinder("muzzle", 0.011, 0.022, 8, (0, 0.052, 0.100), METAL))
    parts.append(box("sight", (0.006, 0.010, 0.008), (0, 0.074, 0.088), DARK))

    obj = join_objects(parts, "Pistol")
    bevel(obj, width=0.003)
    return obj


def shotgun():
    """A break-action double, about 88 cm long. Wood and a wide muzzle."""
    parts = []

    # Two barrels side by side, which is the whole silhouette.
    for side, x in (("l", -0.014), ("r", 0.014)):
        parts.append(cylinder(f"barrel_{side}", 0.013, 0.520, 8, (x, 0.060, 0.040), METAL))

    parts.append(box("receiver", (0.046, 0.048, 0.110), (0, 0.052, 0.020), METAL))
    parts.append(box("forestock", (0.048, 0.034, 0.170), (0, 0.032, 0.190), WOOD))

    # Stock, raked down and back.
    stock = box("stock", (0.036, 0.070, 0.230), (0, 0.020, -0.150), WOOD)
    rotate_verts(stock, (-0.10, 0, 0), pivot=(0, 0.050, -0.040))
    parts.append(stock)

    grip = box("grip", (0.030, 0.062, 0.040), (0, -0.010, -0.040), WOOD)
    rotate_verts(grip, (0.22, 0, 0), pivot=(0, 0.020, -0.030))
    parts.append(grip)

    parts.append(box("guard", (0.024, 0.008, 0.040), (0, 0.014, 0.006), DARK))

    obj = join_objects(parts, "Shotgun")
    bevel(obj, width=0.003)
    return obj


def carbine():
    """A short, straight-lined carbine, about 66 cm. Boxy on purpose."""
    parts = []

    parts.append(cylinder("barrel", 0.011, 0.290, 8, (0, 0.066, 0.130), METAL))
    parts.append(box("receiver", (0.040, 0.058, 0.220), (0, 0.056, 0.040), DARK))
    parts.append(box("handguard", (0.038, 0.040, 0.170), (0, 0.062, 0.180), METAL))

    # Magazine, angled forward — the one detail that says "carbine" at a glance.
    mag = box("magazine", (0.024, 0.110, 0.038), (0, -0.020, 0.040), DARK)
    rotate_verts(mag, (-0.16, 0, 0), pivot=(0, 0.030, 0.040))
    parts.append(mag)

    grip = box("grip", (0.028, 0.076, 0.036), (0, -0.014, -0.030), DARK)
    rotate_verts(grip, (0.30, 0, 0), pivot=(0, 0.024, -0.020))
    parts.append(grip)

    # Fixed tube stock rather than a folding one: fewer parts, clearer shape.
    parts.append(cylinder("stock_tube", 0.014, 0.150, 8, (0, 0.056, -0.220), METAL))
    parts.append(box("butt", (0.034, 0.058, 0.026), (0, 0.050, -0.222), DARK))

    parts.append(box("sight_rear", (0.010, 0.016, 0.012), (0, 0.094, -0.030), DARK))
    parts.append(box("sight_front", (0.008, 0.016, 0.010), (0, 0.090, 0.360), DARK))

    obj = join_objects(parts, "Carbine")
    bevel(obj, width=0.003)
    return obj


def build():
    reset_scene()
    objs = [pistol(), shotgun(), carbine()]
    info = export_glb(objs, "weapons.glb")
    info["objects"] = {o.name: tri_count(o) for o in objs}
    info["tris"] = sum(info["objects"].values())
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
