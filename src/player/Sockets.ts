/**
 * Attachment points on the rig.
 *
 * A socket is a named offset from a bone, not an object. That matters: if
 * sockets were scene objects the rig would have to ship one per possible
 * attachment, and a carried box, a steering wheel and a pistol would each need
 * their own authored empty. As offsets they are data — Phase 5 can add a
 * handlebar grip without touching the character GLB.
 *
 * Offsets are in the bone's local space, metres and radians, and follow the
 * repository's glTF convention: +Z forward, +Y up.
 */

export type SocketId =
  | 'hand_r'
  | 'hand_l'
  | 'carry'
  | 'phone'
  | 'weapon'
  | 'weapon_holster'
  | 'seat'
  | 'steering_wheel'
  | 'handlebar_l'
  | 'handlebar_r'
  | 'back';

export interface Vec3Tuple {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SocketDef {
  readonly id: SocketId;
  /** Bone in the authored rig this hangs from. */
  readonly bone: string;
  readonly position: Vec3Tuple;
  /** Euler XYZ, radians. */
  readonly rotation: Vec3Tuple;
  /**
   * True when the socket is a *target* the character reaches toward rather
   * than a place things hang from. A steering wheel does not follow the hand;
   * the hand follows it.
   */
  readonly isTarget: boolean;
  /** Which phase the thing that uses this arrives in. Documentation only. */
  readonly availableFrom: number;
}

const v = (x: number, y: number, z: number): Vec3Tuple => ({ x, y, z });

/**
 * The socket table.
 *
 * Bone names match `build_character.py`. Vehicle and weapon sockets are
 * declared now with best-effort offsets so Phase 5 and Phase 9 have somewhere
 * to attach without a rig change — they are marked with the phase that will
 * first exercise them, and their offsets should be treated as provisional
 * until something real is fitted to them.
 */
export const SOCKETS: readonly SocketDef[] = [
  { id: 'hand_r', bone: 'hand_r', position: v(0, 0, 0), rotation: v(0, 0, 0), isTarget: false, availableFrom: 4 },
  { id: 'hand_l', bone: 'hand_l', position: v(0, 0, 0), rotation: v(0, 0, 0), isTarget: false, availableFrom: 4 },

  // Carried box or bag: held in front of the chest, both hands reaching to it.
  { id: 'carry', bone: 'spine_02', position: v(0, 0.06, 0.26), rotation: v(0, 0, 0), isTarget: true, availableFrom: 4 },
  // Phone: right hand, angled toward the face.
  { id: 'phone', bone: 'hand_r', position: v(0.02, 0.03, 0.04), rotation: v(-0.5, 0, 0), isTarget: false, availableFrom: 4 },
  { id: 'back', bone: 'spine_02', position: v(0, 0.04, -0.14), rotation: v(0, 0, 0), isTarget: false, availableFrom: 4 },

  { id: 'seat', bone: 'hips', position: v(0, 0, 0), rotation: v(0, 0, 0), isTarget: true, availableFrom: 5 },
  { id: 'steering_wheel', bone: 'spine_02', position: v(0, 0.05, 0.34), rotation: v(0, 0, 0), isTarget: true, availableFrom: 5 },
  { id: 'handlebar_l', bone: 'spine_02', position: v(-0.28, 0.02, 0.32), rotation: v(0, 0, 0), isTarget: true, availableFrom: 5 },
  { id: 'handlebar_r', bone: 'spine_02', position: v(0.28, 0.02, 0.32), rotation: v(0, 0, 0), isTarget: true, availableFrom: 5 },

  { id: 'weapon', bone: 'hand_r', position: v(0, 0.02, 0.05), rotation: v(0, 0, 0), isTarget: false, availableFrom: 9 },
  { id: 'weapon_holster', bone: 'thigh_r', position: v(0.08, -0.1, 0), rotation: v(0, 0, 0), isTarget: false, availableFrom: 9 },
];

const BY_ID = new Map(SOCKETS.map((s) => [s.id, s]));

export function socket(id: SocketId): SocketDef | null {
  return BY_ID.get(id) ?? null;
}

/** Sockets usable right now, i.e. whose content exists. */
export function socketsAvailableIn(phase: number): readonly SocketDef[] {
  return SOCKETS.filter((s) => s.availableFrom <= phase);
}

/** Every distinct bone the socket table depends on. */
export function requiredBones(): readonly string[] {
  return [...new Set(SOCKETS.map((s) => s.bone))].sort();
}

/**
 * Check the rig actually has the bones the sockets name.
 *
 * Called at load in development. A socket pointing at a bone that was renamed
 * in `build_character.py` would otherwise fail silently — the attached item
 * simply never moves, which reads as an animation bug rather than a missing
 * bone.
 */
export function validateAgainstRig(boneNames: readonly string[]): string[] {
  const have = new Set(boneNames);
  return requiredBones().filter((b) => !have.has(b));
}
