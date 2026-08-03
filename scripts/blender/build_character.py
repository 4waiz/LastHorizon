"""
LastHorizon — procedural player character.

Builds an original stylized child explorer (straw hat, loose tee, shorts,
canvas shoes), rigs it to a 21 bone armature, authors six hand-keyed
animation clips and exports `public/assets/models/player.glb`.

* ~1.36 m tall, faces -Y in Blender  ->  +Z in glTF.
* Origin sits between the feet at Z=0 so the root lands on the ground plane.
* Skinning is deterministic: each mesh part declares which bones may
  influence it, then weights fall off as 1/d^4 over that subset. No reliance
  on bone-heat weighting, which fails silently on non-manifold low-poly meshes.
"""

import bpy
import math
import os
import sys
from mathutils import Vector, Quaternion

sys.path.append(os.path.dirname(os.path.abspath(__file__))
                if "__file__" in dir() else
                "C:/Users/awaiz/OneDrive/Desktop/LastHorizon/scripts/blender")
from lh_common import (  # noqa: E402
    reset_scene, mk_material, box, cylinder, mesh_from, bevel,
    apply_modifiers, join_objects, export_glb, tri_count,
)

DEG = math.radians
FPS = 30

# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------

def ring(z, cx, cy, hw, hd, k=0.55):
    """Octagonal cross-section: a rounded rectangle in 8 points, CCW from +Z."""
    return [
        (cx + hw, cy - hd * k, z), (cx + hw, cy + hd * k, z),
        (cx + hw * k, cy + hd, z), (cx - hw * k, cy + hd, z),
        (cx - hw, cy + hd * k, z), (cx - hw, cy - hd * k, z),
        (cx - hw * k, cy - hd, z), (cx + hw * k, cy - hd, z),
    ]


def boolean_diff(obj, cutters):
    """Carve `cutters` out of `obj`, then delete them. Keeps obj's material."""
    mat = obj.data.materials[0] if obj.data.materials else None
    for c in cutters:
        m = obj.modifiers.new("bool_" + c.name, "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = c
        m.solver = "EXACT"
        c.display_type = "WIRE"
    apply_modifiers(obj)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    obj.data.materials.clear()
    if mat:
        obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def loft_z(name, sections, mat_key, cap_bottom=True, cap_top=True):
    """Loft octagonal rings stacked along Z.

    sections: list of (z, cx, cy, half_width, half_depth[, k])
    """
    verts, faces = [], []
    n = len(sections)
    for s in sections:
        z, cx, cy, hw, hd = s[0], s[1], s[2], s[3], s[4]
        k = s[5] if len(s) > 5 else 0.55
        verts.extend(ring(z, cx, cy, hw, hd, k))
    for r in range(n - 1):
        for i in range(8):
            j = (i + 1) % 8
            faces.append((r * 8 + i, r * 8 + j, (r + 1) * 8 + j, (r + 1) * 8 + i))
    if cap_bottom:
        faces.append(tuple(range(7, -1, -1)))
    if cap_top:
        faces.append(tuple(range((n - 1) * 8, n * 8)))
    return mesh_from(name, verts, faces, mat_key)


# --------------------------------------------------------------------------
# Skeleton definition
# --------------------------------------------------------------------------
# (name, head, tail, parent, connected)
BONES = [
    ("root",       (0.000,  0.000, 0.000), (0.000, -0.150, 0.000), None,       False),
    ("hips",       (0.000,  0.000, 0.585), (0.000,  0.000, 0.700), "root",     False),
    ("spine",      (0.000,  0.000, 0.700), (0.000,  0.000, 0.845), "hips",     True),
    ("chest",      (0.000,  0.000, 0.845), (0.000,  0.000, 0.990), "spine",    True),
    ("neck",       (0.000,  0.000, 0.990), (0.000,  0.000, 1.058), "chest",    True),
    ("head",       (0.000,  0.000, 1.058), (0.000,  0.000, 1.290), "neck",     True),

    ("shoulder.L", (0.032,  0.000, 0.952), (0.135,  0.000, 0.965), "chest",    False),
    ("upperarm.L", (0.135,  0.000, 0.965), (0.175,  0.000, 0.778), "shoulder.L", True),
    ("lowerarm.L", (0.175,  0.000, 0.778), (0.196,  0.000, 0.618), "upperarm.L", True),
    ("hand.L",     (0.196,  0.000, 0.618), (0.200,  0.000, 0.540), "lowerarm.L", True),

    ("shoulder.R", (-0.032, 0.000, 0.952), (-0.135, 0.000, 0.965), "chest",    False),
    ("upperarm.R", (-0.135, 0.000, 0.965), (-0.175, 0.000, 0.778), "shoulder.R", True),
    ("lowerarm.R", (-0.175, 0.000, 0.778), (-0.196, 0.000, 0.618), "upperarm.R", True),
    ("hand.R",     (-0.196, 0.000, 0.618), (-0.200, 0.000, 0.540), "lowerarm.R", True),

    ("thigh.L",    (0.072,  0.000, 0.585), (0.078,  0.000, 0.335), "hips",     False),
    ("shin.L",     (0.078,  0.000, 0.335), (0.080,  0.000, 0.078), "thigh.L",  True),
    ("foot.L",     (0.080,  0.000, 0.078), (0.080, -0.118, 0.026), "shin.L",   True),

    ("thigh.R",    (-0.072, 0.000, 0.585), (-0.078, 0.000, 0.335), "hips",     False),
    ("shin.R",     (-0.078, 0.000, 0.335), (-0.080, 0.000, 0.078), "thigh.R",  True),
    ("foot.R",     (-0.080, 0.000, 0.078), (-0.080, -0.118, 0.026), "shin.R",  True),
]


def build_armature():
    arm_data = bpy.data.armatures.new("PlayerRig")
    arm = bpy.data.objects.new("PlayerRig", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    created = {}
    for name, head, tail, parent, connect in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
        created[name] = eb
    for name, _h, _t, parent, connect in BONES:
        if parent:
            created[name].parent = created[parent]
            created[name].use_connect = connect

    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


# --------------------------------------------------------------------------
# Mesh parts.  Each entry: (object, [bones allowed to influence it])
# --------------------------------------------------------------------------

ARM_L = ["upperarm.L", "lowerarm.L", "hand.L"]
ARM_R = ["upperarm.R", "lowerarm.R", "hand.R"]
LEG_L = ["thigh.L", "shin.L", "foot.L"]
LEG_R = ["thigh.R", "shin.R", "foot.R"]
TORSO = ["hips", "spine", "chest", "neck"]


def build_parts():
    parts = []

    # ---- head -------------------------------------------------------------
    # Rounded cube: big and readable, the way the reference frame reads at
    # third-person distance. Front of the face sits at y = -0.099.
    head = box("head", (0.216, 0.206, 0.238), (0, 0.004, 1.152), "skin")
    bevel(head, 0.058, 4)
    parts.append((head, ["head"]))

    for s, tag in ((1, "L"), (-1, "R")):
        ear = box("ear." + tag, (0.022, 0.044, 0.058), (s * 0.109, 0.014, 1.136), "skin")
        bevel(ear, 0.010, 2)
        parts.append((ear, ["head"]))

    # ---- hair --------------------------------------------------------------
    # Offsetting the head shape and carving away the face gives hair that
    # actually hugs the skull. Stacked boxes always read as a helmet.
    shell = box("hair", (0.216, 0.206, 0.238), (0, 0.004, 1.152), "hair")
    bevel(shell, 0.058, 4)
    apply_modifiers(shell)
    shell.scale = (1.122, 1.128, 1.110)
    shell.location = (0, 0.004 * (1 - 1.128), 1.152 * (1 - 1.110))

    cutters = [
        # face opening: only as wide as the face, so hair still runs down
        # the sides of the head as sideburns
        box("cutA", (0.212, 0.30, 0.26), (0, -0.190, 1.075)),
        # flat hairline just under the ear tops — a short boy's cut, not a bob
        box("cutB", (0.50, 0.60, 0.16), (0, 0.020, 1.028)),
    ]
    for s in (1, -1):
        # expose the ears, keeping a thin sideburn in front of each
        cutters.append(box("cutC%d" % s, (0.22, 0.30, 0.26), (s * 0.198, 0.150, 1.040)))
    boolean_diff(shell, cutters)
    parts.append((shell, ["head"]))

    # Chunky locks along the hairline. Without them the offset shell reads as
    # one flat dark panel from behind, which is the giveaway of a cheap model.
    LOCKS = [
        (0.000, 0.096, 1.098, 0.074, 0.062, 0.062),
        (-0.058, 0.092, 1.104, 0.058, 0.058, 0.056),
        (0.058, 0.092, 1.104, 0.058, 0.058, 0.056),
        (-0.040, 0.098, 1.238, 0.056, 0.050, 0.054),
        (0.048, 0.100, 1.232, 0.050, 0.046, 0.050),
    ]
    for i, (lx, ly, lz, lw, ld, lh) in enumerate(LOCKS):
        lock = box("lock%d" % i, (lw, ld, lh), (lx, ly, lz), "hair")
        bevel(lock, 0.016, 2)
        parts.append((lock, ["head"]))

    # ---- face --------------------------------------------------------------
    for s, tag in ((1, "L"), (-1, "R")):
        eye = box("eye." + tag, (0.036, 0.024, 0.056), (s * 0.052, -0.092, 1.134), "eye")
        bevel(eye, 0.011, 2)
        parts.append((eye, ["head"]))
        spark = box("spark." + tag, (0.012, 0.012, 0.014), (s * 0.059, -0.100, 1.150),
                    "trim_white")
        parts.append((spark, ["head"]))
        brow = box("brow." + tag, (0.042, 0.014, 0.012), (s * 0.053, -0.096, 1.182), "hair")
        parts.append((brow, ["head"]))

    mouth = box("mouth", (0.030, 0.012, 0.009), (0, -0.098, 1.084), "hair")
    parts.append((mouth, ["head"]))

    # ---- straw hat ---------------------------------------------------------
    brim = cylinder("hat_brim", 0.216, 0.019, verts=22, center=(0, 0.006, 1.264),
                    mat_key="hat_straw", radius_top=0.232)
    parts.append((brim, ["head"]))
    crown = cylinder("hat_crown", 0.142, 0.082, verts=22, center=(0, 0.006, 1.270),
                     mat_key="hat_straw", radius_top=0.128)
    parts.append((crown, ["head"]))
    band = cylinder("hat_band", 0.146, 0.023, verts=22, center=(0, 0.006, 1.276),
                    mat_key="hat_band", radius_top=0.144)
    parts.append((band, ["head"]))

    # ---- shirt ------------------------------------------------------------
    shirt = loft_z("shirt", [
        (0.612, 0, 0.000, 0.130, 0.090, 0.60),
        (0.700, 0, 0.000, 0.125, 0.086, 0.58),
        (0.800, 0, 0.000, 0.118, 0.079, 0.56),
        (0.900, 0, 0.000, 0.114, 0.075, 0.56),
        (0.968, 0, 0.000, 0.119, 0.076, 0.58),
        (1.000, 0, 0.000, 0.100, 0.068, 0.60),
    ], "shirt")
    parts.append((shirt, TORSO + ["shoulder.L", "shoulder.R"]))

    # neck — short and thick; a long thin neck instantly reads as "adult".
    neck = loft_z("neck_geo", [
        (0.968, 0, 0.008, 0.052, 0.048),
        (1.052, 0, 0.006, 0.049, 0.046),
    ], "skin")
    parts.append((neck, ["neck", "head", "chest"]))

    # ---- sleeves / arms / hands ------------------------------------------
    for s, tag, bones in ((1, "L", ARM_L), (-1, "R", ARM_R)):
        # Sleeve starts inside the torso so the capped end is never visible.
        sleeve = loft_z("sleeve." + tag, [
            (0.978, s * 0.096, 0, 0.050, 0.052),
            (0.936, s * 0.126, 0, 0.057, 0.056),
            (0.872, s * 0.146, 0, 0.059, 0.057),
            (0.840, s * 0.155, 0, 0.055, 0.053),
        ], "shirt", cap_bottom=True, cap_top=False)
        parts.append((sleeve, ["shoulder." + tag, "upperarm." + tag, "chest"]))

        arm = loft_z("arm." + tag, [
            (0.862, s * 0.151, 0, 0.036, 0.036),
            (0.790, s * 0.166, 0, 0.033, 0.033),
            (0.700, s * 0.183, 0, 0.030, 0.030),
            (0.632, s * 0.194, 0, 0.028, 0.028),
        ], "skin", cap_top=False)
        parts.append((arm, bones))

        hand = loft_z("hand." + tag, [
            (0.634, s * 0.194, 0.000, 0.030, 0.028),
            (0.596, s * 0.198, -0.003, 0.036, 0.026),
            (0.556, s * 0.199, -0.005, 0.033, 0.024),
            (0.536, s * 0.199, -0.005, 0.022, 0.017),
        ], "skin")
        parts.append((hand, ["hand." + tag, "lowerarm." + tag]))

    # ---- shorts -----------------------------------------------------------
    shorts = loft_z("shorts", [
        (0.628, 0, 0.000, 0.122, 0.086, 0.60),
        (0.560, 0, 0.000, 0.127, 0.090, 0.60),
        (0.490, 0, 0.000, 0.132, 0.092, 0.60),
        (0.452, 0, 0.000, 0.130, 0.090, 0.60),
    ], "shorts")
    parts.append((shorts, ["hips", "spine", "thigh.L", "thigh.R"]))

    for s, tag in ((1, "L"), (-1, "R")):
        cuff = loft_z("cuff." + tag, [
            (0.470, s * 0.070, 0, 0.058, 0.062),
            (0.412, s * 0.073, 0, 0.056, 0.060),
        ], "shorts", cap_top=False)
        parts.append((cuff, ["thigh." + tag, "hips"]))

    # ---- legs -------------------------------------------------------------
    for s, tag, bones in ((1, "L", LEG_L), (-1, "R", LEG_R)):
        leg = loft_z("leg." + tag, [
            (0.430, s * 0.074, 0.000, 0.045, 0.046),
            (0.360, s * 0.076, 0.000, 0.041, 0.042),
            (0.320, s * 0.078, 0.002, 0.038, 0.040),
            (0.240, s * 0.079, 0.000, 0.035, 0.037),
            (0.150, s * 0.080, -0.002, 0.031, 0.033),
            (0.086, s * 0.080, -0.004, 0.028, 0.029),
        ], "skin", cap_top=False)
        parts.append((leg, bones))

        # shoe: sole + upper + rounded toe
        upper = loft_z("shoe_up." + tag, [
            (0.030, s * 0.080, -0.014, 0.041, 0.070, 0.62),
            (0.062, s * 0.080, -0.016, 0.040, 0.066, 0.60),
            (0.092, s * 0.080, -0.002, 0.035, 0.044, 0.60),
        ], "shoe")
        parts.append((upper, ["foot." + tag]))
        sole = box("sole." + tag, (0.086, 0.164, 0.030), (s * 0.080, -0.020, 0.017), "shoe")
        bevel(sole, 0.013, 2)
        parts.append((sole, ["foot." + tag]))
        toe = box("toe." + tag, (0.078, 0.052, 0.052), (s * 0.080, -0.070, 0.038), "shoe")
        bevel(toe, 0.022, 3)
        parts.append((toe, ["foot." + tag]))

    return parts


# --------------------------------------------------------------------------
# Deterministic skinning
# --------------------------------------------------------------------------

def _dist_to_segment(p, a, b):
    ab = b - a
    denom = ab.dot(ab)
    t = 0.0 if denom < 1e-9 else max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


def skin_parts(parts, arm):
    """Assign vertex groups per part using inverse-distance falloff."""
    segs = {}
    for name, head, tail, _p, _c in BONES:
        segs[name] = (Vector(head), Vector(tail))

    for obj, allowed in parts:
        apply_modifiers(obj)
        groups = {b: obj.vertex_groups.new(name=b) for b in allowed}
        mw = obj.matrix_world
        for v in obj.data.vertices:
            p = mw @ v.co
            scored = []
            for b in allowed:
                a, t = segs[b]
                d = _dist_to_segment(p, a, t)
                scored.append((1.0 / ((d + 0.004) ** 4), b))
            scored.sort(reverse=True)
            scored = scored[:3]
            total = sum(s[0] for s in scored)
            for w, b in scored:
                nw = w / total
                if nw > 0.002:
                    groups[b].add([v.index], nw, "REPLACE")


# --------------------------------------------------------------------------
# Animation
# --------------------------------------------------------------------------

_REST_CACHE = {}


def _bone_rest(arm, name):
    if name not in _REST_CACHE:
        _REST_CACHE[name] = arm.data.bones[name].matrix_local.to_3x3()
    return _REST_CACHE[name]


def set_pose(arm, bone, frame, rx=0.0, ry=0.0, rz=0.0, loc=None):
    """Key a bone using WORLD-space axis rotations (degrees, right-hand rule).

    Rotating about world X pitches an upward bone forward for rx>0 and swings
    a downward limb backward for rx>0.  Expressing everything against the
    world axes keeps the animation data readable regardless of bone roll.
    """
    pb = arm.pose.bones[bone]
    m = _bone_rest(arm, bone)
    minv = m.inverted()

    q = Quaternion((1, 0, 0), 0)
    for axis, ang in ((Vector((0, 0, 1)), rz), (Vector((0, 1, 0)), ry), (Vector((1, 0, 0)), rx)):
        if abs(ang) > 1e-6:
            q = q @ Quaternion(minv @ axis, DEG(ang))
    pb.rotation_quaternion = q
    pb.keyframe_insert("rotation_quaternion", frame=frame)

    if loc is not None:
        pb.location = minv @ Vector(loc)
        pb.keyframe_insert("location", frame=frame)


def new_action(arm, name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    return act


def action_fcurves(act):
    """Blender 4.4+ moved F-curves into slotted action channelbags."""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    curves = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                curves.extend(cb.fcurves)
    return curves


def finalize(act, interp="BEZIER"):
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = interp
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"


def _clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = Vector((0, 0, 0))


# ---- clip: idle ----------------------------------------------------------

def anim_idle(arm):
    _clear_pose(arm)
    act = new_action(arm, "Idle")
    N = 90
    for f in range(1, N + 1, 5):
        t = (f - 1) / N
        breathe = math.sin(t * math.tau)
        sway = math.sin(t * math.tau - 0.7)
        look = math.sin(t * math.tau * 0.5)

        set_pose(arm, "hips", f, rx=-1.0 + breathe * 0.6, rz=sway * 1.2,
                 loc=(sway * 0.004, 0, -0.004 + breathe * 0.005))
        set_pose(arm, "spine", f, rx=1.6 + breathe * 1.0, rz=-sway * 0.8)
        set_pose(arm, "chest", f, rx=-0.8 + breathe * 1.6, rz=-sway * 1.0)
        set_pose(arm, "neck", f, rx=1.4 - breathe * 0.6)
        set_pose(arm, "head", f, rx=1.0 - breathe * 0.8, rz=look * 3.2, ry=look * 1.4)

        for s, tag in ((1, "L"), (-1, "R")):
            ph = 1.0 if s > 0 else -1.0
            set_pose(arm, "shoulder." + tag, f, rx=breathe * 0.8)
            set_pose(arm, "upperarm." + tag, f, rx=2.0 + breathe * 1.6,
                     ry=s * (-3.5 + sway * ph * 1.0))
            set_pose(arm, "lowerarm." + tag, f, rx=-6.0 - breathe * 1.4,
                     ry=s * -2.0)
            set_pose(arm, "hand." + tag, f, rx=-3.0)
            set_pose(arm, "thigh." + tag, f, rx=-0.8, ry=s * -1.2)
            set_pose(arm, "shin." + tag, f, rx=2.0)
            set_pose(arm, "foot." + tag, f, rx=-1.0)
    finalize(act)
    return act


# ---- clip: walk ----------------------------------------------------------
# 30 frames @ 30 fps = 1.0 s, authored for ~1.45 m/s ground speed.

WALK_THIGH = [(1, -26), (8, -6), (16, 20), (20, 6), (24, -18), (28, -30), (31, -26)]
WALK_SHIN = [(1, 7), (8, 11), (16, 5), (19, 54), (24, 38), (28, 10), (31, 7)]
WALK_FOOT = [(1, 9), (5, -2), (8, -4), (16, -22), (20, 6), (24, 2), (31, 9)]
WALK_UPARM = [(1, 20), (8, 8), (16, -20), (24, -6), (31, 20)]
WALK_LOARM = [(1, -10), (8, -18), (16, -24), (24, -14), (31, -10)]


def _sample(track, f, period):
    """Piecewise-linear sample of a keyed track, wrapped over `period`."""
    ff = ((f - 1) % period) + 1
    for i in range(len(track) - 1):
        f0, v0 = track[i]
        f1, v1 = track[i + 1]
        if f0 <= ff <= f1:
            u = 0.0 if f1 == f0 else (ff - f0) / (f1 - f0)
            u = u * u * (3 - 2 * u)
            return v0 + (v1 - v0) * u
    return track[-1][1]


def _cycle(arm, name, N, thigh, shin, foot, uparm, loarm, lean, bob, sway,
           hip_yaw, chest_yaw, elbow_extra=0.0, arm_out=0.0):
    _clear_pose(arm)
    act = new_action(arm, name)
    half = N // 2
    for f in range(1, N + 2):
        t = (f - 1) / N
        bobv = -bob * math.cos(t * math.tau * 2.0)
        swayv = sway * math.sin(t * math.tau)

        set_pose(arm, "hips", f, rx=lean * 0.35, rz=hip_yaw * math.sin(t * math.tau),
                 loc=(swayv, 0, bobv))
        set_pose(arm, "spine", f, rx=lean * 0.3, rz=chest_yaw * 0.4 * -math.sin(t * math.tau))
        set_pose(arm, "chest", f, rx=lean * 0.35, rz=chest_yaw * -math.sin(t * math.tau))
        set_pose(arm, "neck", f, rx=-lean * 0.25)
        set_pose(arm, "head", f, rx=-lean * 0.45, rz=chest_yaw * 0.3 * math.sin(t * math.tau))

        for s, tag, off in ((1, "L", 0), (-1, "R", half)):
            set_pose(arm, "thigh." + tag, f, rx=_sample(thigh, f + off, N), ry=s * -1.5)
            set_pose(arm, "shin." + tag, f, rx=_sample(shin, f + off, N))
            set_pose(arm, "foot." + tag, f, rx=_sample(foot, f + off, N))

            aoff = half if off == 0 else 0
            set_pose(arm, "shoulder." + tag, f, rx=_sample(uparm, f + aoff, N) * 0.10)
            set_pose(arm, "upperarm." + tag, f, rx=_sample(uparm, f + aoff, N),
                     ry=s * (-3.0 - arm_out))
            set_pose(arm, "lowerarm." + tag, f,
                     rx=_sample(loarm, f + aoff, N) - elbow_extra, ry=s * -3.0)
            set_pose(arm, "hand." + tag, f, rx=-4.0)
    finalize(act)
    return act


def anim_walk(arm):
    return _cycle(arm, "Walk", 30, WALK_THIGH, WALK_SHIN, WALK_FOOT,
                  WALK_UPARM, WALK_LOARM, lean=4.0, bob=0.011, sway=0.009,
                  hip_yaw=-5.0, chest_yaw=6.0)


# ---- clip: run -----------------------------------------------------------
# 22 frames @ 30 fps = 0.733 s, authored for ~4.1 m/s.

RUN_THIGH = [(1, -40), (5, -14), (11, 26), (14, 12), (18, -30), (23, -40)]
RUN_SHIN = [(1, 24), (5, 12), (11, 10), (14, 88), (18, 62), (23, 24)]
RUN_FOOT = [(1, 6), (4, -10), (11, -30), (15, 10), (19, 8), (23, 6)]
RUN_UPARM = [(1, 34), (6, 16), (12, -36), (18, -6), (23, 34)]
RUN_LOARM = [(1, -70), (6, -84), (12, -66), (18, -74), (23, -70)]


def anim_run(arm):
    return _cycle(arm, "Run", 22, RUN_THIGH, RUN_SHIN, RUN_FOOT,
                  RUN_UPARM, RUN_LOARM, lean=15.0, bob=0.026, sway=0.006,
                  hip_yaw=-8.0, chest_yaw=10.0, elbow_extra=0.0, arm_out=4.0)


# ---- clip: jump / fall / land -------------------------------------------

def _pose_all(arm, f, hips_loc, hips_rx, spine, chest, neck, head,
              thigh, shin, foot, uparm, loarm, arm_out=0.0, split=0.0):
    set_pose(arm, "hips", f, rx=hips_rx, loc=hips_loc)
    set_pose(arm, "spine", f, rx=spine)
    set_pose(arm, "chest", f, rx=chest)
    set_pose(arm, "neck", f, rx=neck)
    set_pose(arm, "head", f, rx=head)
    for s, tag in ((1, "L"), (-1, "R")):
        set_pose(arm, "shoulder." + tag, f, rx=uparm * 0.12)
        set_pose(arm, "upperarm." + tag, f, rx=uparm, ry=s * (-3.0 - arm_out))
        set_pose(arm, "lowerarm." + tag, f, rx=loarm, ry=s * -3.0)
        set_pose(arm, "hand." + tag, f, rx=-4.0)
        set_pose(arm, "thigh." + tag, f, rx=thigh + s * split, ry=s * (-1.5 - split * 0.4))
        set_pose(arm, "shin." + tag, f, rx=shin)
        set_pose(arm, "foot." + tag, f, rx=foot)


def anim_jump(arm):
    _clear_pose(arm)
    act = new_action(arm, "JumpStart")
    _pose_all(arm, 1, (0, 0, 0.000), 0, 2, 0, 0, 0, -2, 4, -2, 4, -8)
    _pose_all(arm, 5, (0, 0, -0.105), 6, 10, 20, -10, -14, -30, 62, 14, 44, -26)
    _pose_all(arm, 10, (0, 0, 0.040), -2, -2, -6, 4, 6, -6, 6, -34, -72, -18, arm_out=10)
    _pose_all(arm, 14, (0, 0, 0.010), 0, 0, -2, 2, 2, -20, 34, -14, -56, -26, arm_out=12)
    finalize(act)
    return act


def anim_fall(arm):
    _clear_pose(arm)
    act = new_action(arm, "Fall")
    N = 36
    for f in range(1, N + 2):
        t = (f - 1) / N
        w = math.sin(t * math.tau)
        w2 = math.sin(t * math.tau + 1.1)
        set_pose(arm, "hips", f, rx=-3 + w * 1.5, loc=(0, 0, 0))
        set_pose(arm, "spine", f, rx=-3 + w * 1.2)
        set_pose(arm, "chest", f, rx=-5 + w2 * 1.6)
        set_pose(arm, "neck", f, rx=3.0)
        set_pose(arm, "head", f, rx=5 - w * 1.5)
        for s, tag, ph in ((1, "L", 1.0), (-1, "R", -1.0)):
            set_pose(arm, "upperarm." + tag, f, rx=-92 + w * 6 * ph,
                     ry=s * (-26 - w * 4))
            set_pose(arm, "shoulder." + tag, f, rx=-10)
            set_pose(arm, "lowerarm." + tag, f, rx=-30 + w2 * 6 * ph, ry=s * -8)
            set_pose(arm, "hand." + tag, f, rx=-6)
            set_pose(arm, "thigh." + tag, f, rx=(-20 if ph > 0 else 4) + w * 4 * ph,
                     ry=s * -6)
            set_pose(arm, "shin." + tag, f, rx=(34 if ph > 0 else 18) + w2 * 5)
            set_pose(arm, "foot." + tag, f, rx=-14)
    finalize(act)
    return act


def anim_land(arm):
    _clear_pose(arm)
    act = new_action(arm, "Land")
    _pose_all(arm, 1, (0, 0, -0.010), -2, -2, -4, 2, 4, -10, 16, -18, -40, -24, arm_out=8)
    _pose_all(arm, 5, (0, 0, -0.132), 8, 12, 24, -12, -16, -28, 64, 12, -22, -46, arm_out=6)
    _pose_all(arm, 11, (0, 0, -0.042), 3, 5, 10, -4, -6, -12, 26, 2, 8, -22)
    _pose_all(arm, 18, (0, 0, 0.000), -1, 2, 0, 1, 1, -2, 4, -2, 4, -8)
    finalize(act)
    return act


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build():
    reset_scene()
    bpy.context.scene.render.fps = FPS
    _REST_CACHE.clear()

    arm = build_armature()
    parts = build_parts()
    skin_parts(parts, arm)

    mesh = join_objects([p[0] for p in parts], "PlayerMesh")
    mesh.parent = arm
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    clips = [anim_idle(arm), anim_walk(arm), anim_run(arm),
             anim_jump(arm), anim_fall(arm), anim_land(arm)]
    _clear_pose(arm)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.animation_data.action = None

    info = export_glb([arm, mesh], "player.glb", animations=True)
    info["tris"] = tri_count(mesh)
    info["clips"] = [c.name for c in clips]
    info["bones"] = len(BONES)
    return info


if __name__ == "__main__" or True:
    RESULT = build()
    print(RESULT)
