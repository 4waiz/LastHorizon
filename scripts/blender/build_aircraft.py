"""
LastHorizon — the airstrip kit: one light aircraft, and one small motorboat.

Both are original, procedural, and built from the shared palette. No downloaded
model, no real manufacturer, no registration marks, no livery that belongs to
anybody. The plane is a generic high-wing single, which is the shape a
five-year-old draws when you say "small aeroplane", and that is exactly the
right amount of specificity for a toon village.

Origin convention, same as `build_vehicles.py` and it matters just as much:
the origin sits at the **chassis origin the physics uses**, not on the ground.
For the plane that is the point the flight model integrates — roughly the wing
root, slightly forward of the main gear so the nose drops when the engine
stops. Gear contact lands at `-(gearY + wheelRadius)`.

Every dimension is taken from `src/vehicles/aircraftCatalog.ts` and the two have
to agree; `vehicleAssets.test.ts` checks them.

Exports, matching the convention the runtime already reads:

    Name        full detail
    Name_LOD1   fewer round segments, no cabin interior, no struts
    Name_LOD2   silhouette only — a body, a wing plank and a tail
    Name_Col    collision proxy, never rendered
    Name_Prop   the propeller disc, spun by the runtime rather than by a clip

`Name_Prop` is a separate node on purpose. A propeller at 2,400 rpm is not
something to bake into an animation clip and stream — the runtime spins one
node about its local Z, which costs a quaternion per frame and reads correctly
at any frame rate.

From a terminal:

    blender --background --python scripts/blender/build_aircraft.py
"""

import importlib
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else \
    "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender"
if HERE not in sys.path:
    sys.path.append(HERE)

import lh_common as C
importlib.reload(C)


# Blender is Z-up; the game and glTF are Y-up with +Z forward. `build_vehicles.py`
# solves this with the same two helpers, and every size and position below goes
# through them. Writing game-space numbers straight into Blender builds a plane
# standing on its tail, which is exactly what the first preview render showed.

def P(x, up, fwd):
    """Game-space point (x, up, forward) -> Blender Z-up (x, forward, up)."""
    return (x, fwd, up)


def S(width, height, length):
    """Game-space size -> Blender Z-up size."""
    return (width, length, height)


# ---------------------------------------------------------------------------
# The aeroplane
# ---------------------------------------------------------------------------
#
# Dimensions mirror PLANE in src/vehicles/aircraftCatalog.ts:
#   span 9.4, length 6.6, height 2.5
#   main gear at x +/-1.05, y -0.95, z -0.15, radius 0.26
#   nose gear at z 2.05
#
# The wing sits *above* the cabin (high-wing) for two unglamorous reasons: the
# player is looking down at the world from a chase camera, and a low wing would
# occlude most of it.

SPAN = 9.4
LENGTH = 6.6
GEAR_Y = -0.95
GEAR_R = 0.26
# Wing underside clears the cabin roof (0.70) by 17 cm, so the struts have
# something to span and the silhouette reads as high-wing from the side.
WING_Y = 0.95


def _fuselage(prefix, segments=8, detail=True):
    """Cabin pod plus tail boom. Two pieces, because the taper is not linear."""
    out = []

    # Cabin: a boxy pod with a cut nose. Wide enough to read as two seats.
    out.append(C.box(prefix + "_cabin", S(1.30, 1.30, 3.00), P(0, 0.05, 0.35),
                     "vehicle_paint"))
    # Nose cone, tapering to the spinner.
    # `wedge` has full height at -Y sloping toward +Y. In Blender-Z-up terms
    # that is full height at the rear sloping to the front, which is a nose
    # cone already — no rotation needed.
    out.append(C.wedge(prefix + "_nose", S(1.20, 1.10, 1.10), P(0, 0.02, 2.20),
                       "vehicle_paint"))
    # Tail boom, thinner and dropping slightly.
    out.append(C.box(prefix + "_boom", S(0.62, 0.66, 2.30), P(0, 0.08, -2.05),
                     "vehicle_paint"))

    if detail:
        # Windscreen and side glass. One material, so no extra program.
        out.append(C.box(prefix + "_glass_f", S(1.16, 0.62, 0.70), P(0, 0.52, 1.55),
                         "vehicle_glass"))
        out.append(C.box(prefix + "_glass_l", S(1.34, 0.54, 1.30), P(0, 0.46, 0.55),
                         "vehicle_glass"))
        # Door seam, a thin darker plate so the cabin is not one flat slab.
        out.append(C.box(prefix + "_door", S(1.36, 0.70, 1.00), P(0, -0.18, 0.45),
                         "vehicle_trim"))

    return out


def _wing(prefix, detail=True):
    """High wing, one plank, with struts down to the fuselage."""
    out = []
    # Main plank. Thin, full span, slight chord taper is not worth the tris.
    out.append(C.box(prefix + "_wing", S(SPAN, 0.16, 1.55), P(0, WING_Y, 0.55),
                     "vehicle_paint"))
    # Wingtips, angled up a touch so the silhouette is not a pure rectangle.
    for s in (-1, 1):
        out.append(C.box(prefix + "_tip%d" % (s > 0), S(0.55, 0.15, 1.20),
                         P(s * (SPAN / 2 - 0.1), WING_Y + 0.05, 0.55), "vehicle_trim"))

    if detail:
        # Lift struts. The single most recognisable feature of a high-wing
        # light aircraft, and four boxes.
        for s in (-1, 1):
            out.append(C.box(prefix + "_strut%d" % (s > 0), S(0.10, 1.30, 0.16),
                             P(s * 1.90, 0.30, 0.50), "metal_grey"))
        # Ailerons, as trim-coloured inserts at the trailing edge.
        for s in (-1, 1):
            out.append(C.box(prefix + "_ail%d" % (s > 0), S(2.10, 0.10, 0.34),
                             P(s * 2.90, WING_Y, -0.05), "vehicle_trim"))
    return out


def _tail(prefix, detail=True):
    """Fin, rudder, tailplane and elevators."""
    out = []
    # Vertical fin.
    # `wedge` is tall at -Y, which through `P` is game-rear — already a fin.
    # An earlier version turned it 180 degrees and produced a fin that was
    # tall at the nose; the orthographic side view is what caught it.
    out.append(C.wedge(prefix + "_fin", S(0.14, 1.15, 1.30), P(0, 0.92, -2.90),
                       "vehicle_paint"))
    # Horizontal tailplane.
    out.append(C.box(prefix + "_tailplane", S(3.10, 0.12, 0.85), P(0, 0.30, -2.95),
                     "vehicle_paint"))
    if detail:
        out.append(C.box(prefix + "_rudder", S(0.12, 0.80, 0.36), P(0, 0.95, -3.42),
                         "vehicle_trim"))
        for s in (-1, 1):
            out.append(C.box(prefix + "_elev%d" % (s > 0), S(1.30, 0.10, 0.30), P(s * 0.85, 0.30, -3.30), "vehicle_trim"))
    return out


def _gear(prefix, segments=8, detail=True):
    """Fixed tricycle gear. Never retracts — this is not that kind of plane."""
    out = []
    # Main gear legs and wheels.
    for s in (-1, 1):
        out.append(C.box(prefix + "_leg%d" % (s > 0), S(0.12, 0.80, 0.14), P(s * 1.05, GEAR_Y + 0.45, -0.15), "metal_grey"))
        w = C.cylinder(prefix + "_wheel%d" % (s > 0), GEAR_R, 0.16, verts=segments,
                       center=(0, 0, -0.08), mat_key="tyre")
        C.rotate_verts(w, (0, math.radians(90), 0))
        C.transform(w, loc=P(s * 1.05, GEAR_Y, -0.15))
        out.append(w)
    # Nose gear, forward and slightly smaller.
    out.append(C.box(prefix + "_nleg", S(0.12, 0.78, 0.14), P(0, GEAR_Y + 0.46, 2.05),
                     "metal_grey"))
    nw = C.cylinder(prefix + "_nwheel", GEAR_R * 0.82, 0.14, verts=segments,
                    center=(0, 0, -0.07), mat_key="tyre")
    C.rotate_verts(nw, (0, math.radians(90), 0))
    C.transform(nw, loc=P(0, GEAR_Y + 0.04, 2.05))
    out.append(nw)
    return out


def _lights(prefix):
    """Nav lights: red left, green right, white tail. Tiny, and they read."""
    out = []
    out.append(C.box(prefix + "_navL", S(0.16, 0.12, 0.16),
                     P(-(SPAN / 2 - 0.1), WING_Y + 0.08, 0.55), "light_lens"))
    out.append(C.box(prefix + "_navR", S(0.16, 0.12, 0.16),
                     P((SPAN / 2 - 0.1), WING_Y + 0.08, 0.55), "light_lens"))
    out.append(C.box(prefix + "_navT", S(0.12, 0.14, 0.12), P(0, 1.44, -3.30),
                     "lamp_glass"))
    return out


def propeller(name, segments=8):
    """
    The propeller, as its own object so the runtime can spin it.

    Origin is placed at the hub, which is what makes `rotation.z += w * dt`
    correct rather than a wobble. Two blades and a spinner: at any speed the
    game runs, this is a blur.
    """
    parts = []
    hub = C.cylinder(name + "_hub", 0.16, 0.34, verts=segments,
                     center=(0, 0, -0.17), mat_key="vehicle_trim")
    # Lay the hub down so its axis runs along game-forward (Blender +Y).
    C.rotate_verts(hub, (math.radians(90), 0, 0))
    parts.append(hub)
    for i in range(2):
        # Tall in game-up, thin across, spun about the forward axis so the two
        # blades oppose.
        b = C.box(name + "_blade%d" % i, S(0.14, 1.72, 0.05), P(0, 0, 0),
                  "pole_dark")
        C.rotate_verts(b, (0, math.radians(18 + 180 * i), 0))
        parts.append(b)
    obj = C.join_objects(parts, name)
    C.set_origin_to(obj, (0, 0, 0))
    return obj


def collision_proxy(name):
    """
    One box for the fuselage, one flat box for the wing.

    Two boxes rather than one, because a single hull around a 9.4 m span would
    make the plane collide with hangar walls it visibly clears, and a single
    hull around the fuselage would let a wingtip pass through a tree. This is
    the cheapest shape that is not a lie in either direction.
    """
    parts = [
        C.box(name + "_body", S(1.40, 1.60, LENGTH), P(0, 0.0, 0.0), "vehicle_trim"),
        C.box(name + "_wing", S(SPAN, 0.30, 1.55), P(0, WING_Y, 0.55), "vehicle_trim"),
    ]
    obj = C.join_objects(parts, name)
    obj.hide_render = True
    return obj


def build_plane():
    """Full detail, two LODs, a collision proxy and a detached propeller."""
    made = []

    full = _fuselage("P_x") + _wing("P_x") + _tail("P_x") + _gear("P_x") + _lights("P_x")
    made.append(C.join_objects(full, "Plane"))

    # LOD1: no struts, no ailerons, no elevators, no glass, coarser wheels.
    # Taken at 60 m, where a strut is under a pixel.
    l1 = (_fuselage("P_l1", segments=6, detail=False)
          + _wing("P_l1", detail=False)
          + _tail("P_l1", detail=False)
          + _gear("P_l1", segments=6, detail=False))
    made.append(C.join_objects(l1, "Plane_LOD1"))

    # LOD2: silhouette. A body, a wing plank, a tail cross. This is what the
    # aircraft looks like from another aircraft, and from the ground at 300 m.
    l2 = [
        C.box("P_l2_body", S(1.30, 1.30, LENGTH), P(0, 0.05, 0.0), "vehicle_paint"),
        C.box("P_l2_wing", S(SPAN, 0.16, 1.55), P(0, WING_Y, 0.55), "vehicle_paint"),
        C.box("P_l2_tailp", S(3.10, 0.12, 0.85), P(0, 0.30, -2.95), "vehicle_paint"),
        C.box("P_l2_fin", S(0.14, 1.10, 1.30), P(0, 0.92, -2.90), "vehicle_paint"),
    ]
    made.append(C.join_objects(l2, "Plane_LOD2"))

    made.append(collision_proxy("Plane_Col"))
    made.append(propeller("Plane_Prop"))
    return made


# ---------------------------------------------------------------------------
# The motorboat
# ---------------------------------------------------------------------------
#
# Mirrors BOAT in src/vehicles/aircraftCatalog.ts: beam 1.9, length 4.6,
# height 1.3. Origin at the waterline the buoyancy model solves against, so
# `y = 0` is where the hull sits at rest in calm water. That makes the
# buoyancy check `origin.y vs waterLevel` rather than an offset nobody
# remembers.

BEAM = 1.9
HULL = 4.6


def _hull(prefix, detail=True):
    """
    A box hull with a wedge bow, rather than one wedge along the whole length.

    The first version tapered across all 4.6 m and rendered as a doorstop: a
    boat is mostly parallel-sided with the taper in the front third, and the
    silhouette is wrong without that. Two boxes buy the difference.
    """
    out = []
    # Parallel-sided body, stern to just forward of midships.
    out.append(C.box(prefix + "_hull", S(BEAM, 0.70, HULL * 0.66),
                     P(0, -0.22, -0.78), "vehicle_paint"))
    # Bow, tapering over the front third. `wedge` is deep at -Y (game-rear),
    # which is what joins flush to the box behind it.
    out.append(C.wedge(prefix + "_bow", S(BEAM, 0.70, HULL * 0.34),
                       P(0, -0.22, 1.53), "vehicle_paint"))
    # Gunwale. Two side rails rather than one full-width slab — the slab was a
    # lid, and it hid the entire hull under a dark rectangle.
    for s in (-1, 1):
        out.append(C.box(prefix + "_rail%d" % (s > 0), S(0.16, 0.16, HULL * 0.92),
                         P(s * (BEAM / 2 - 0.08), 0.16, -0.1), "vehicle_trim"))
    # Deck.
    out.append(C.box(prefix + "_deck", S(BEAM - 0.24, 0.08, 1.60), P(0, 0.10, 1.05),
                     "wood_light"))
    if detail:
        # Console and seat.
        out.append(C.box(prefix + "_console", S(0.62, 0.52, 0.36), P(0, 0.36, 0.35),
                         "vehicle_trim"))
        out.append(C.box(prefix + "_seat", S(0.80, 0.14, 0.52), P(0, 0.30, -0.45),
                         "shirt_shade"))
        # Outboard motor on the transom.
        out.append(C.box(prefix + "_motor", S(0.34, 0.62, 0.40), P(0, 0.10, -2.35),
                         "metal_grey"))
        out.append(C.box(prefix + "_shaft", S(0.14, 0.50, 0.16), P(0, -0.32, -2.42),
                         "pole_dark"))
    return out


def boat_collision(name):
    """One box. A boat hits a dock, and a dock is a box."""
    obj = C.box(name, S(BEAM, 0.90, HULL), P(0, -0.15, 0.0), "vehicle_trim")
    obj.hide_render = True
    return obj


def build_boat():
    made = []
    made.append(C.join_objects(_hull("B_x"), "Boat"))
    made.append(C.join_objects(_hull("B_l1", detail=False), "Boat_LOD1"))
    made.append(C.join_objects([
        C.wedge("B_l2_hull", S(BEAM, 0.70, HULL), P(0, -0.22, 0.0), "vehicle_paint"),
    ], "Boat_LOD2"))
    made.append(boat_collision("Boat_Col"))
    return made


def build():
    C.reset_scene()
    C.clear_material_cache()
    counts = {}

    objs = build_plane() + build_boat()

    for o in objs:
        counts[o.name] = C.tri_count(o)

    result = C.export_glb(objs, "aircraft.glb")
    result["objects"] = len(objs)
    result["tris"] = counts
    result["total_tris"] = sum(counts.values())
    return result


RESULT = build()
if __name__ != "__main__":
    print(RESULT)
