"""Workbench preview renders used while art-directing the generated assets."""

import bpy
import math


def _camera(loc, rot, lens):
    cd = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = rot
    cd.lens = lens
    bpy.context.scene.camera = cam
    return cam


def _stage(res, bg=(0.62, 0.72, 0.84)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    if sc.world is None:
        sc.world = bpy.data.worlds.new("PreviewWorld")
    sc.world.color = bg
    return sc


def render_character(poses, out, cam_loc, cam_rot, lens, res=(1200, 700)):
    """poses: list of (x_offset, z_rotation_radians, action_name)."""
    sc = _stage(res)
    arm = bpy.data.objects["PlayerRig"]
    mesh = bpy.data.objects["PlayerMesh"]
    for x, rotz, act_name in poses:
        a2 = arm.copy()
        a2.data = arm.data.copy()
        bpy.context.collection.objects.link(a2)
        m2 = mesh.copy()
        m2.data = mesh.data.copy()
        bpy.context.collection.objects.link(m2)
        m2.parent = a2
        for md in m2.modifiers:
            if md.type == "ARMATURE":
                md.object = a2
        a2.location = (x, 0, 0)
        a2.rotation_euler = (0, 0, rotz)
        a2.animation_data_create()
        act = bpy.data.actions[act_name]
        a2.animation_data.action = act
        if hasattr(a2.animation_data, "action_slot") and len(act.slots):
            a2.animation_data.action_slot = act.slots[0]
    arm.hide_render = True
    mesh.hide_render = True
    _camera(cam_loc, cam_rot, lens)
    sc.frame_set(8)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    return out


def render_objects(out, cam_loc=(2.6, -4.6, 2.4), target=(0, 0, 1.1), lens=42,
                   res=(1280, 760)):
    """Render every visible mesh in the scene, aimed at `target`."""
    sc = _stage(res)
    cam = _camera(cam_loc, (0, 0, 0), lens)
    d = [target[i] - cam_loc[i] for i in range(3)]
    # A Blender camera looks down its local -Z. Solving
    #   f = Rz(rz) * Rx(rx) * (0,0,-1)
    # gives rx = atan2(|d_xy|, -d_z) and rz = atan2(-d_x, d_y).
    cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0,
                          math.atan2(-d[0], d[1]))
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    return out
