"""
LastHorizon — the vehicle kit.

Bicycle, scooter, hatchback, delivery van and a police variant, all procedural,
all built from the shared palette. No textures, no unique materials per car: a
red hatchback and a blue one are the same mesh with `vehicle_paint` retinted at
runtime, which is what `VehicleDefinition.colourVariants` means.

Every dimension here is taken from `src/vehicles/VehicleDefinition.ts`. The two
have to agree or the wheels will not meet the ground the suspension casts to,
so the numbers are duplicated deliberately and `vehicles.test.ts` checks them.

Origin convention, and it matters: the model's origin sits at the **chassis
origin** the physics uses, not on the ground and not at the centre of the body.
Wheels are placed at their spec `position`, so the contact patch lands at
`-(wheelY + radius)`. Getting this wrong makes a car that floats or one whose
wheels are buried, and neither is obvious until it is driven.

Each vehicle exports as:

    Name        full detail
    Name_LOD1   fewer round segments, small details dropped
    Name_LOD2   cars only: a block and four wheels
    Name_Col    collision proxy, one box, never rendered

From a terminal:

    blender --background --python scripts/blender/build_vehicles.py
"""

import importlib
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else \
    "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender"
if HERE not in sys.path:
    sys.path.append(HERE)

import lh_common as C  # noqa: E402
importlib.reload(C)


# ---------------------------------------------------------------------------
# Axes
# ---------------------------------------------------------------------------
#
# The rest of this kit is authored in Blender's Z-up world and exported with
# `export_yup=True`, which rotates it into glTF's Y-up on the way out. The
# vehicle *definitions*, though, are written in the game's convention: +Y up,
# +Z forward.
#
# Rather than write every literal in the exporter's frame -- which reads as
# nonsense next to VehicleDefinition.ts and is where this file first went wrong,
# producing five cars stood on their tails -- author in the game's convention
# and convert at the call.

def P(x, up, fwd):
    """Game-space point (x, up, forward) -> Blender Z-up (x, forward, up)."""
    return (x, fwd, up)


def S(width, height, length):
    """Game-space size -> Blender Z-up size."""
    return (width, length, height)


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------

def wheel(name, radius, width, center, segments=10, rim=True):
    """A wheel lying on its side, axle along X."""
    parts = []
    # `cylinder` extrudes from `center` along +Z, so start half a width back
    # to get one centred on the origin before rotating it.
    tyre = C.cylinder(name + "_tyre", radius, width, verts=segments,
                      center=(0, 0, -width / 2), mat_key="tyre")
    # `cylinder` builds along +Z; roll it so the axle runs across the vehicle.
    C.rotate_verts(tyre, (0, math.radians(90), 0))
    C.transform(tyre, loc=P(*center))
    parts.append(tyre)

    if rim:
        hub = C.cylinder(name + "_rim", radius * 0.45, width * 1.05, verts=max(6, segments - 2),
                         center=(0, 0, -width * 0.525), mat_key="rim")
        C.rotate_verts(hub, (0, math.radians(90), 0))
        C.transform(hub, loc=P(*center))
        parts.append(hub)

    return C.join_objects(parts, name)


def lamp(name, size, center, key):
    return C.box(name, S(*size), center=P(*center), mat_key=key)


# ---------------------------------------------------------------------------
# Cars
# ---------------------------------------------------------------------------

def car_shell(prefix, width, height, length, wheel_r, wheel_x, wheel_z, wheel_y,
              paint="vehicle_paint", cabin_drop=0.0, van=False, segments=10):
    """
    A car body: lower box, cabin above it, glass, lights, bumpers and wheels.

    `van` squares the cabin off and runs it the whole length, which is the whole
    visual difference between the hatchback and the delivery van.
    """
    parts = []
    hw, hl = width / 2, length / 2

    # Main body. Sits above the wheel centres so the arches read.
    body_h = height * (0.46 if not van else 0.34)
    body_y = wheel_y + wheel_r * 0.55 + body_h / 2
    parts.append(C.box(prefix + "_body", S(width, body_h, length),
                       center=P(0, body_y, 0), mat_key=paint))

    # Cabin.
    cab_h = height - body_h - cabin_drop
    cab_y = body_y + body_h / 2 + cab_h / 2
    if van:
        cab_w, cab_l, cab_z = width * 0.97, length * 0.82, -length * 0.06
    else:
        cab_w, cab_l, cab_z = width * 0.86, length * 0.46, -length * 0.05
    parts.append(C.box(prefix + "_cabin", S(cab_w, cab_h, cab_l),
                       center=P(0, cab_y, cab_z), mat_key=paint))

    # Glass, inset slightly so it does not z-fight the cabin.
    g_h = cab_h * 0.55
    g_y = cab_y + cab_h * 0.08
    parts.append(C.box(prefix + "_glass_f", S(cab_w * 0.92, g_h, 0.06),
                       center=P(0, g_y, cab_z + cab_l / 2), mat_key="vehicle_glass"))
    parts.append(C.box(prefix + "_glass_b", S(cab_w * 0.92, g_h, 0.06),
                       center=P(0, g_y, cab_z - cab_l / 2), mat_key="vehicle_glass"))
    parts.append(C.box(prefix + "_glass_l", S(0.06, g_h, cab_l * 0.9),
                       center=P(-cab_w / 2, g_y, cab_z), mat_key="vehicle_glass"))
    parts.append(C.box(prefix + "_glass_r", S(0.06, g_h, cab_l * 0.9),
                       center=P(cab_w / 2, g_y, cab_z), mat_key="vehicle_glass"))

    # One simple interior: a seat block and a dashboard. Visible through the
    # glass, and it is the only interior the brief asks for.
    parts.append(C.box(prefix + "_seats", S(cab_w * 0.8, cab_h * 0.42, cab_l * 0.5),
                       center=P(0, cab_y - cab_h * 0.22, cab_z - cab_l * 0.08),
                       mat_key="seat_dark"))
    parts.append(C.box(prefix + "_dash", S(cab_w * 0.85, cab_h * 0.16, 0.12),
                       center=P(0, cab_y - cab_h * 0.1, cab_z + cab_l * 0.42),
                       mat_key="vehicle_trim"))

    # Bumpers.
    bump_y = body_y - body_h * 0.28
    for tag, z in (("f", hl - 0.04), ("b", -hl + 0.04)):
        parts.append(C.box(prefix + "_bumper_" + tag, S(width * 0.98, height * 0.11, 0.1),
                       center=P(0, bump_y, z), mat_key="vehicle_trim"))

    # Lights, positioned to match the LightSpec entries in the definition.
    lens_y = body_y + body_h * 0.1
    for sx in (-1, 1):
        parts.append(lamp(prefix + "_head_%d" % sx, (width * 0.22, height * 0.09, 0.07),
                          (sx * width * 0.34, lens_y, hl - 0.02), "light_lens"))
        parts.append(lamp(prefix + "_brake_%d" % sx, (width * 0.2, height * 0.1, 0.07),
                          (sx * width * 0.36, lens_y + height * 0.06, -hl + 0.02), "brake_lens"))

    # Wheels.
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(wheel(prefix + "_w_%d_%d" % (sx, sz), wheel_r, width * 0.13,
                               (sx * wheel_x, wheel_y, sz * wheel_z), segments=segments))

    return parts


def car_lod1(prefix, width, height, length, wheel_r, wheel_x, wheel_z, wheel_y,
             paint="vehicle_paint", van=False):
    """Same silhouette, coarser wheels, no interior and no separate lenses."""
    parts = []
    hl = length / 2
    body_h = height * (0.46 if not van else 0.34)
    body_y = wheel_y + wheel_r * 0.55 + body_h / 2
    parts.append(C.box(prefix + "_body", S(width, body_h, length),
                       center=P(0, body_y, 0), mat_key=paint))

    cab_h = height - body_h
    cab_y = body_y + body_h / 2 + cab_h / 2
    if van:
        cab_w, cab_l, cab_z = width * 0.97, length * 0.82, -length * 0.06
    else:
        cab_w, cab_l, cab_z = width * 0.86, length * 0.46, -length * 0.05
    parts.append(C.box(prefix + "_cabin", S(cab_w, cab_h, cab_l),
                       center=P(0, cab_y, cab_z), mat_key=paint))
    parts.append(C.box(prefix + "_glass_f", S(cab_w * 0.92, cab_h * 0.55, 0.06),
                       center=P(0, cab_y + cab_h * 0.08, cab_z + cab_l / 2),
                       mat_key="vehicle_glass"))

    for sx in (-1, 1):
        parts.append(lamp(prefix + "_head_%d" % sx, (width * 0.22, height * 0.09, 0.07),
                          (sx * width * 0.34, body_y, hl - 0.02), "light_lens"))
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(wheel(prefix + "_w_%d_%d" % (sx, sz), wheel_r, width * 0.13,
                               (sx * wheel_x, wheel_y, sz * wheel_z), segments=6, rim=False))
    return parts


def car_lod2(prefix, width, height, length, wheel_r, wheel_x, wheel_z, wheel_y,
             paint="vehicle_paint"):
    """A block and four discs. Past 80 m this is a few pixels tall."""
    parts = [C.box(prefix + "_body", S(width, height * 0.82, length),
                       center=P(0, wheel_y + wheel_r * 0.55 + height * 0.41, 0), mat_key=paint)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            parts.append(wheel(prefix + "_w_%d_%d" % (sx, sz), wheel_r, width * 0.13,
                               (sx * wheel_x, wheel_y, sz * wheel_z), segments=5, rim=False))
    return parts


# ---------------------------------------------------------------------------
# Two-wheelers
# ---------------------------------------------------------------------------

def bicycle_parts(prefix, segments=12, detail=True):
    """
    A diamond frame, forks, bars and a saddle.

    Dimensions from BICYCLE: 0.6 x 1.1 x 1.75, wheels r 0.34 at z +-0.53,
    y -0.10, handlebar sockets at y 0.95 / z 0.36.
    """
    parts = []
    wy, wr, wz = -0.10, 0.34, 0.53

    for tag, z in (("f", wz), ("b", -wz)):
        parts.append(wheel(prefix + "_w_" + tag, wr, 0.06, (0, wy, z),
                           segments=segments, rim=detail))

    # Frame: a few tubes between the hubs, the saddle and the bars.
    hub_f, hub_b = (0, wy, wz), (0, wy, -wz)
    bb = (0, wy + 0.08, -0.06)          # bottom bracket
    seat_t = (0, wy + 0.72, -0.24)      # top of the seat tube
    head_t = (0, wy + 0.82, 0.30)       # top of the head tube

    tubes = [
        (bb, seat_t), (bb, hub_b), (seat_t, hub_b),
        (bb, head_t), (seat_t, head_t), (head_t, hub_f),
    ]
    for i, (a, b) in enumerate(tubes):
        parts.append(C.tube_along(prefix + "_tube%d" % i, [P(*a), P(*b)], 0.022,
                                  verts=6 if detail else 4, mat_key="frame_steel"))

    # Handlebars, spanning the two sockets the definition names.
    parts.append(C.tube_along(prefix + "_bars",
                              [P(-0.26, wy + 1.05, 0.36), P(0.26, wy + 1.05, 0.36)],
                              0.02, verts=6 if detail else 4, mat_key="frame_steel"))
    parts.append(C.box(prefix + "_saddle", S(0.11, 0.05, 0.26),
                       center=P(0, wy + 1.02, -0.26), mat_key="seat_dark"))

    if detail:
        parts.append(C.box(prefix + "_lamp", S(0.06, 0.05, 0.05),
                       center=P(0, wy + 0.82, 0.42), mat_key="light_lens"))
        parts.append(C.box(prefix + "_rear", S(0.05, 0.05, 0.04),
                       center=P(0, wy + 0.72, -0.68), mat_key="brake_lens"))
        for sx in (-1, 1):
            parts.append(C.box(prefix + "_pedal_%d" % sx, S(0.07, 0.02, 0.14),
                       center=P(sx * 0.09, wy + 0.02, -0.06), mat_key="vehicle_trim"))
    return parts


def scooter_parts(prefix, segments=12, detail=True):
    """
    Step-through frame with a body panel.

    From SCOOTER: 0.68 x 1.2 x 1.9, wheels r 0.26 at z +-0.58, y -0.14.
    """
    parts = []
    wy, wr, wz = -0.14, 0.26, 0.58

    for tag, z in (("f", wz), ("b", -wz)):
        parts.append(wheel(prefix + "_w_" + tag, wr, 0.09, (0, wy, z),
                           segments=segments, rim=detail))

    # Body panel and floor, which is what makes it read as a scooter rather
    # than a small motorcycle.
    parts.append(C.box(prefix + "_rear", S(0.34, 0.34, 0.62),
                       center=P(0, wy + 0.30, -0.30), mat_key="vehicle_paint"))
    parts.append(C.box(prefix + "_floor", S(0.32, 0.08, 0.5),
                       center=P(0, wy + 0.10, 0.06), mat_key="vehicle_trim"))
    parts.append(C.box(prefix + "_front", S(0.3, 0.54, 0.24),
                       center=P(0, wy + 0.44, 0.44), mat_key="vehicle_paint"))
    parts.append(C.box(prefix + "_seat", S(0.3, 0.10, 0.44),
                       center=P(0, wy + 0.52, -0.24), mat_key="seat_dark"))

    parts.append(C.tube_along(prefix + "_fork",
                              [P(0, wy, wz), P(0, wy + 0.78, 0.40)], 0.028,
                              verts=6 if detail else 4, mat_key="frame_steel"))
    parts.append(C.tube_along(prefix + "_bars",
                              [P(-0.30, wy + 0.86, 0.42), P(0.30, wy + 0.86, 0.42)],
                              0.022, verts=6 if detail else 4, mat_key="frame_steel"))

    if detail:
        parts.append(C.box(prefix + "_lamp", S(0.14, 0.10, 0.06),
                       center=P(0, wy + 0.62, 0.56), mat_key="light_lens"))
        parts.append(C.box(prefix + "_tail", S(0.10, 0.08, 0.05),
                       center=P(0, wy + 0.50, -0.62), mat_key="brake_lens"))
        for sx in (-1, 1):
            parts.append(C.box(prefix + "_mirror_%d" % sx, S(0.05, 0.04, 0.02),
                       center=P(sx * 0.30, wy + 0.98, 0.40), mat_key="vehicle_trim"))
    return parts


# ---------------------------------------------------------------------------
# Collision proxies
# ---------------------------------------------------------------------------

def collision_proxy(name, width, height, length, wheel_y, wheel_r):
    """
    One box, sized to the definition and sitting where the body does.

    A proxy rather than the render mesh for the same reason `CollisionWorld`
    uses proxies: a wing mirror or a wheel arch in the collision hull turns
    every kerb into something to snag on.
    """
    centre_y = wheel_y + wheel_r * 0.55 + height * 0.4
    return C.box(name, S(width, height * 0.9, length * 0.98),
                       center=P(0, centre_y, 0), mat_key="vehicle_trim")


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

# Kept in step with src/vehicles/VehicleDefinition.ts.
SPECS = {
    "Hatchback": dict(width=1.72, height=1.46, length=3.9,
                      wheel_r=0.31, wheel_x=0.76, wheel_z=1.24, wheel_y=-0.24, van=False),
    "Van":       dict(width=1.90, height=2.24, length=4.85,
                      wheel_r=0.35, wheel_x=0.82, wheel_z=1.52, wheel_y=-0.30, van=True),
    "Police":    dict(width=1.72, height=1.46, length=3.9,
                      wheel_r=0.31, wheel_x=0.76, wheel_z=1.24, wheel_y=-0.24, van=False),
}


def build_car(name):
    spec = SPECS[name]
    made = []

    full = C.join_objects(car_shell(name + "_x", **spec), name)
    made.append(full)

    lod1_spec = {k: v for k, v in spec.items()}
    made.append(C.join_objects(car_lod1(name + "_l1", **lod1_spec), name + "_LOD1"))

    lod2_spec = {k: v for k, v in spec.items() if k != "van"}
    made.append(C.join_objects(car_lod2(name + "_l2", **lod2_spec), name + "_LOD2"))

    made.append(collision_proxy(name + "_Col", spec["width"], spec["height"],
                                spec["length"], spec["wheel_y"], spec["wheel_r"]))
    return made


def build_police_extras(obj_name):
    """A light bar, which is the only geometry the police car adds."""
    parts = []
    parts.append(C.box(obj_name + "_bar", S(0.86, 0.07, 0.18),
                       center=P(0, 1.46, 0.10), mat_key="vehicle_trim"))
    for sx, key in ((-1, "beacon_blue"), (1, "beacon_red")):
        parts.append(C.box(obj_name + "_beacon_%d" % sx, S(0.34, 0.10, 0.16),
                       center=P(sx * 0.24, 1.52, 0.10), mat_key=key))
    return parts


def build():
    C.reset_scene()
    C.clear_material_cache()
    objs = []
    counts = {}

    # --- two-wheelers ---
    bike = C.join_objects(bicycle_parts("Bicycle_x"), "Bicycle")
    bike_lod1 = C.join_objects(bicycle_parts("Bicycle_l1", segments=6, detail=False), "Bicycle_LOD1")
    bike_col = collision_proxy("Bicycle_Col", 0.6, 1.1, 1.75, -0.10, 0.34)
    objs += [bike, bike_lod1, bike_col]

    scoot = C.join_objects(scooter_parts("Scooter_x"), "Scooter")
    scoot_lod1 = C.join_objects(scooter_parts("Scooter_l1", segments=6, detail=False), "Scooter_LOD1")
    scoot_col = collision_proxy("Scooter_Col", 0.68, 1.2, 1.9, -0.14, 0.26)
    objs += [scoot, scoot_lod1, scoot_col]

    # --- cars ---
    for name in ("Hatchback", "Van"):
        objs += build_car(name)

    police = build_car("Police")
    # Fold the light bar into the full-detail body only; at LOD1 and beyond it
    # is a few pixels and the silhouette already reads as a patrol car.
    police[0] = C.join_objects([police[0]] + build_police_extras("Police_x"), "Police")
    objs += police

    for o in objs:
        counts[o.name] = C.tri_count(o)

    result = C.export_glb(objs, "vehicles.glb")
    result["objects"] = len(objs)
    result["tris"] = counts
    result["total_tris"] = sum(counts.values())
    return result


RESULT = build()
if __name__ != "__main__":
    print(RESULT)
