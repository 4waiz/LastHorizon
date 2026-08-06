import * as THREE from 'three';
import { proportionsForAge, type Proportions } from './AgeStages';
import { RIG_BONES, sceneBoneName } from './Sockets';

/**
 * Applies age proportions to the authored rig.
 *
 * Which channels are safe to write is not a matter of taste — it is decided by
 * what the clips key. Reading `player.glb` directly:
 *
 *   rotation     every bone except `root`
 *   translation  `hips` only
 *   scale        nothing at all
 *
 * So bone **scale** is entirely ours and survives every mixer update; bone
 * **position** is ours for everything except hips; bone **rotation** belongs to
 * the mixer, and anything rotational has to be re-applied *after* it runs.
 * That is the whole reason `stoop` lives in `update()` while everything else is
 * set once, when the stage changes.
 *
 * Writing the stoop as a stage property and hoping it stuck would have looked
 * correct in a unit test and done nothing on screen — the mixer overwrites the
 * spine's quaternion on the very next frame.
 */

export interface AppearanceSnapshot {
  /** Rig bones found. 0 means the capsule fallback is in use. */
  bones: number;
  height: number;
  head: number;
  limb: number;
  /** Absolute shoulder offset from the spine — half the shoulder width. */
  shoulderX: number;
  stoop: number;
}

/** Chain roots: scaling one carries the joints below it, lengthening the limb. */
const LIMB_ROOTS = ['upperarm.L', 'upperarm.R', 'thigh.L', 'thigh.R'] as const;
const SHOULDERS = ['shoulder.L', 'shoulder.R'] as const;

/** The clips key `spine`'s rotation, so the stoop is re-applied over the top. */
const STOOP_BONE = 'spine';

export class AgeAppearance {
  private readonly bones = new Map<string, THREE.Object3D>();
  /** Local positions as authored, so repeated applies do not compound. */
  private readonly restPos = new Map<string, THREE.Vector3>();
  private stoop = 0;
  private lastAge: number | null = null;

  /**
   * Bones are keyed by their *authored* name, but matched on the sanitized one:
   * `GLTFLoader` strips the dot, so the loaded scene calls `shoulder.L`
   * `shoulderL`. See `sceneBoneName`.
   */
  constructor(root: THREE.Object3D | null) {
    if (!root) return;
    const wanted = new Map(RIG_BONES.map((b) => [sceneBoneName(b), b]));
    root.traverse((o) => {
      const authored = wanted.get(sceneBoneName(o.name));
      if (authored === undefined || this.bones.has(authored)) return;
      this.bones.set(authored, o);
      this.restPos.set(authored, o.position.clone());
    });
  }

  /** How many rig bones were actually found. 0 means the capsule fallback. */
  get boneCount(): number {
    return this.bones.size;
  }

  has(bone: string): boolean {
    return this.bones.has(bone);
  }

  /**
   * Proportions for an exact age, blended across the stage boundary.
   *
   * Called every frame from `Game.syncAge`, so it early-outs on an age that has
   * not meaningfully moved — a thousandth of a year is still far finer than any
   * visible change, and it keeps a per-frame object allocation out of the loop.
   */
  applyAge(age: number, blendYears = 1): void {
    if (!Number.isFinite(age)) return;
    if (this.lastAge !== null && Math.abs(age - this.lastAge) < 1e-3) return;
    this.lastAge = age;
    this.apply(proportionsForAge(age, blendYears));
  }

  apply(p: Proportions): void {
    // `root` is keyed on no channel at all, so a uniform scale here is the one
    // place overall height can live without fighting the mixer.
    this.setScale('root', p.height);

    // A larger head reads younger. It is a leaf bone, so this stays local.
    this.setScale('head', p.head);

    for (const b of LIMB_ROOTS) this.setScale(b, p.limb);

    // Shoulder width is a position offset, not a scale: scaling the shoulder
    // would drag the arm chain outward with it and lengthen the arm as well.
    for (const b of SHOULDERS) {
      const bone = this.bones.get(b);
      const rest = this.restPos.get(b);
      if (bone && rest) bone.position.set(rest.x * p.shoulders, rest.y, rest.z);
    }

    this.stoop = p.stoop;
  }

  /**
   * Re-apply the rotational part, after the mixer has written the pose.
   *
   * Post-multiplied onto whatever the clip produced rather than replacing it,
   * so a stooped character still walks.
   */
  update(): void {
    if (this.stoop === 0) return;
    this.bones.get(STOOP_BONE)?.rotateX(this.stoop);
  }

  /**
   * What is on the rig right now, read back off the bones.
   *
   * Deliberately not the cached `Proportions` that were passed in: the point of
   * this is to prove the values reached the skeleton, so reporting the input
   * would answer the wrong question.
   */
  snapshot(): AppearanceSnapshot {
    return {
      bones: this.bones.size,
      height: this.bones.get('root')?.scale.y ?? 1,
      head: this.bones.get('head')?.scale.y ?? 1,
      limb: this.bones.get('thigh.L')?.scale.y ?? 1,
      shoulderX: Math.abs(this.bones.get('shoulder.R')?.position.x ?? 0),
      stoop: this.stoop,
    };
  }

  /** Undo everything, back to the authored rig. */
  reset(): void {
    this.stoop = 0;
    this.lastAge = null;
    for (const [name, bone] of this.bones) {
      bone.scale.set(1, 1, 1);
      const rest = this.restPos.get(name);
      if (rest) bone.position.copy(rest);
    }
  }

  private setScale(bone: string, s: number): void {
    this.bones.get(bone)?.scale.set(s, s, s);
  }
}
